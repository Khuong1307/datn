"""
Script giả lập dữ liệu 3 phòng - Gửi lên MySQL modbus_data
Chạy từ Windows để test hệ thống
"""
import pymysql
import random
import time
from datetime import datetime

# --- CẤU HÌNH DATABASE (thay đổi theo server của bạn) ---
DB_CONFIG = {
    "host": "47.128.66.94",  # IP server Ubuntu của bạn
    "user": "root",
    "password": "fbd3b9f31da4a89d",  # Password MySQL
    "database": "power_management",
    "autocommit": True
}

# Mapping register
REG_VOLTAGE = 40000
REG_CURRENT = 40001
REG_POWER = 40002
REG_ENERGY = 40003
REG_DEVICE0 = 40004
REG_DEVICE1 = 40005

# Cấu hình 3 phòng (slave_id)
ROOMS = [
    {"slave_id": 5, "name": "Phòng 1", "base_power": 100},
    {"slave_id": 7, "name": "Phòng 2", "base_power": 150},
    {"slave_id": 9, "name": "Phòng 3", "base_power": 80},
]

# Lưu energy tích lũy cho mỗi phòng
energy_accumulated = {room["slave_id"]: 0 for room in ROOMS}

def get_db():
    """Kết nối database"""
    return pymysql.connect(**DB_CONFIG)

def generate_sensor_data(room):
    """Tạo dữ liệu cảm biến giả lập cho 1 phòng"""
    global energy_accumulated
    
    slave_id = room["slave_id"]
    base_power = room["base_power"]
    
    # Giả lập điện áp (220V +/- 5V)
    voltage = 220 + random.uniform(-5, 5)
    
    # Giả lập công suất (base +/- 30%)
    power = base_power + random.uniform(-base_power * 0.3, base_power * 0.3)
    power = max(0, power)  # Không âm
    
    # Tính dòng điện từ P = U * I
    current = power / voltage if voltage > 0 else 0
    
    # Tích lũy điện năng (kWh) - giả sử mỗi 2 giây
    energy_accumulated[slave_id] += (power / 1000) * (2 / 3600)  # kWh
    
    # Trạng thái thiết bị ngẫu nhiên
    device0 = 1 if power > 50 else 0  # Đèn bật nếu có công suất
    device1 = 1 if power > 100 else 0  # Quạt bật nếu công suất cao
    
    return {
        REG_VOLTAGE: int(voltage * 10),      # *10 để lưu integer
        REG_CURRENT: int(current * 100),     # *100 để lưu integer
        REG_POWER: int(power),
        REG_ENERGY: int(energy_accumulated[slave_id] * 1000),  # *1000 để lưu integer
        REG_DEVICE0: device0,
        REG_DEVICE1: device1
    }

def insert_modbus_data(db, slave_id, reg, value):
    """Insert 1 dòng vào modbus_data"""
    cur = db.cursor()
    cur.execute(
        "INSERT INTO modbus_data (slave_id, reg, value) VALUES (%s, %s, %s)",
        (slave_id, reg, value)
    )

def main():
    print("=" * 50)
    print("🔌 GIẢI LẬP DỮ LIỆU 3 PHÒNG")
    print("=" * 50)
    print(f"📡 Server: {DB_CONFIG['host']}")
    print(f"🗄️  Database: {DB_CONFIG['database']}")
    print(f"🏠 Số phòng: {len(ROOMS)}")
    print("=" * 50)
    
    try:
        db = get_db()
        print("✅ Kết nối database thành công!")
    except Exception as e:
        print(f"❌ Lỗi kết nối: {e}")
        print("\n💡 Kiểm tra:")
        print("   1. IP server đúng chưa?")
        print("   2. MySQL có cho phép remote connection?")
        print("   3. Firewall đã mở port 3306?")
        return
    
    print("\n🚀 Bắt đầu gửi dữ liệu... (Ctrl+C để dừng)\n")
    
    count = 0
    while True:
        try:
            count += 1
            now = datetime.now().strftime("%H:%M:%S")
            
            for room in ROOMS:
                slave_id = room["slave_id"]
                data = generate_sensor_data(room)
                
                # Insert từng register
                for reg, value in data.items():
                    insert_modbus_data(db, slave_id, reg, value)
                
                power = data[REG_POWER]
                voltage = data[REG_VOLTAGE] / 10
                current = data[REG_CURRENT] / 100
                energy = data[REG_ENERGY] / 1000
                
                print(f"[{now}] {room['name']:8} | "
                      f"V={voltage:5.1f}V | "
                      f"I={current:5.3f}A | "
                      f"P={power:4}W | "
                      f"E={energy:6.3f}kWh")
            
            print(f"--- Lần {count} - Đã gửi {len(ROOMS) * 6} records ---\n")
            
            # Đợi 2 giây
            time.sleep(10)
            
        except KeyboardInterrupt:
            print("\n\n🛑 Đã dừng!")
            break
        except Exception as e:
            print(f"❌ Lỗi: {e}")
            # Thử reconnect
            try:
                db = get_db()
            except:
                pass
            time.sleep(2)
    
    db.close()
    print("👋 Tạm biệt!")

if __name__ == "__main__":
    main()
