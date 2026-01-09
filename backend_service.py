import pymysql
import paho.mqtt.client as mqtt
import json
import time
import threading

# --- DB CONFIG ---
DB_CONFIG = {
    "host": "localhost",
    "user": "root",
    "password": "fbd3b9f31da4a89d",
    "database": "power_management",
    "autocommit": True
}

# Global connection
db = None
cur = None

def get_db_connection():
    """Tạo kết nối database mới"""
    global db, cur
    try:
        if db is not None:
            try:
                db.ping(reconnect=True)
                return db, cur
            except:
                pass
        
        db = pymysql.connect(**DB_CONFIG)
        cur = db.cursor()
        print("✅ Database connected")
        return db, cur
    except Exception as e:
        print(f"❌ Database connection error: {e}")
        return None, None

def ensure_connection():
    """Đảm bảo kết nối database còn sống"""
    global db, cur
    try:
        db.ping(reconnect=True)
    except:
        db, cur = get_db_connection()
    return db, cur

# Khởi tạo kết nối ban đầu
db, cur = get_db_connection()

# --- MQTT SETUP ---
client = mqtt.Client()
client.connect("localhost", 1883)

# ⚡ Hàm xử lý dữ liệu nhận từ Master -> Lưu vào DB
def on_message(client, userdata, msg):
    global db, cur
    try:
        # Đảm bảo kết nối
        ensure_connection()
        
        data = json.loads(msg.payload)
        slave_id = data["slaveId"]
        regs     = data["regs"]

        rows = []
        for reg, value in regs.items():
            rows.append((slave_id, int(reg), int(value)))

        cur.executemany(
            """
            INSERT INTO modbus_data(slave_id, reg, value, ts)
            VALUES (%s, %s, %s, NOW())
            """,
            rows
        )
        
        # ⚡ CẬP NHẬT TRẠNG THÁI HIỆN TẠI VÀO BẢNG PENDING (Single Source of Truth)
        # Reg 40004 = Device 0, Reg 40005 = Device 1
        dev0 = regs.get("40004", 0)
        dev1 = regs.get("40005", 0)
        
        # Update bảng pending_commands (Sync View Control)
        cur.execute(
            """
            INSERT INTO pending_commands (slave_id, device0, device1, sync, change_token)
            VALUES (%s, %s, %s, 0, NOW())
            ON DUPLICATE KEY UPDATE device0=%s, device1=%s, change_token=NOW()
            """,
            (slave_id, dev0, dev1, dev0, dev1)
        )
        
        print(f"✅ Data received: Slave={slave_id} | Devices: {dev0}, {dev1} | Synced with Token")
    except Exception as e:
        print(f"❌ Error insert DB: {e}")
        # Thử reconnect
        get_db_connection()

client.subscribe("iot/modbus/slave/+")
client.on_message = on_message

# ⚡ Thread riêng để quét lệnh điều khiển từ Database -> Gửi xuống Master
def command_loop():
    global db, cur
    while True:
        try:
            # Đảm bảo kết nối
            ensure_connection()
            
            # 1. Tìm các lệnh CẦN GỬI (sync = 1) - Do User kích hoạt
            cur.execute("SELECT slave_id, device0, device1 FROM pending_commands WHERE sync = 1")
            commands = cur.fetchall()

            for cmd in commands:
                slave_id, dev0, dev1 = cmd
                
                # 2. Gửi MQTT
                payload = json.dumps({
                    "device0": dev0,
                    "device1": dev1
                })
                
                topic = f"iot/control/slave/{slave_id}"
                client.publish(topic, payload, qos=1, retain=True)
                print(f"🚀 Sent Command to Slave {slave_id} (Retained): {payload}")
                
                # 3. Xác nhận đã gửi -> Set sync = 0
                cur.execute("UPDATE pending_commands SET sync = 0 WHERE slave_id = %s", (slave_id,))
            
        except Exception as e:
            print(f"⚠️ Command Loop Error: {e}")
            # Reconnect DB
            get_db_connection()
            
        time.sleep(1)  # Quét mỗi 1 giây

# Chạy loop nhận dữ liệu MQTT ở background
client.loop_start()

# Chạy vòng lặp quét database ở main thread
print("🚀 Service Started: Listening MQTT & Scanning DB...")
command_loop()
