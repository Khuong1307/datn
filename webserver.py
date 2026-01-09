"""
Flask API Server - Kết nối MySQL cho hệ thống giám sát điện năng
Sử dụng bảng modbus_data và pending_commands
"""
from flask import Flask, jsonify, request
from flask_cors import CORS
import pymysql
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import json
from datetime import datetime, timezone, timedelta

# Vietnam Timezone (UTC+7)
VN_TIMEZONE = timezone(timedelta(hours=7))

app = Flask(__name__)
CORS(app)

# ASGI wrapper (for running with Uvicorn)
# Cài đặt: pip install asgiref
try:
    from asgiref.wsgi import WsgiToAsgi
    _has_asgiref = True
except ImportError:
    _has_asgiref = False
    print("⚠️  asgiref chưa được cài. Chạy: pip install asgiref")
    print("   Hoặc dùng: python webserver.py thay vì uvicorn")

# --- DB CONFIG ---
DB_CONFIG = {
    "host": "localhost",
    "user": "root",
    "password": "fbd3b9f31da4a89d",
    "database": "power_management",
    "autocommit": True,
    "cursorclass": pymysql.cursors.DictCursor
}

# Mapping register -> ý nghĩa
REG_VOLTAGE = 40000
REG_CURRENT = 40001
REG_POWER = 40002
REG_ENERGY = 40003
REG_DEVICE0 = 40004
REG_DEVICE1 = 40005

# Timeout (giây) - nếu không có data mới trong 60s thì coi như mất kết nối
TIMEOUT_SECONDS = 60

# Cài đặt mặc định (sẽ được load từ DB)
DEFAULT_SETTINGS = {
    "thresholds": {"warning": 502, "critical": 1000},
    "tier_limits": {"tier1": 50, "tier2": 100, "tier3": 200, "tier4": 300, "tier5": 400},
    "tier_prices": [1984, 2050, 2380, 2998, 3350, 3460],
    "vat": 8,
    "email": {
        "enabled": False,
        "recipient": "",
        "smtp_server": "smtp.gmail.com",
        "smtp_port": 587,
        "sender_email": "",
        "sender_password": ""
    }
}

ROOM_NAMES = {5: "Phòng 1", 7: "Phòng 2"}

# Biến lưu thời điểm gửi email cuối cùng (tránh spam)
last_email_sent = None
EMAIL_COOLDOWN = 300  # 5 phút giữa các email

def load_settings_from_db():
    """Load settings từ database khi khởi động"""
    global DEFAULT_SETTINGS
    try:
        db = get_db()
        cur = db.cursor()
        cur.execute("SELECT * FROM settings WHERE id = 1")
        row = cur.fetchone()
        if row:
            DEFAULT_SETTINGS["thresholds"]["warning"] = row.get('threshold_warning', 502)
            DEFAULT_SETTINGS["thresholds"]["critical"] = row.get('threshold_critical', 1000)
            DEFAULT_SETTINGS["tier_limits"] = {
                "tier1": row.get('tier_limit1', 50),
                "tier2": row.get('tier_limit2', 100),
                "tier3": row.get('tier_limit3', 200),
                "tier4": row.get('tier_limit4', 300),
                "tier5": row.get('tier_limit5', 400)
            }
            tier_prices_raw = row.get('tier_prices', '[1984, 2050, 2380, 2998, 3350, 3460]')
            if isinstance(tier_prices_raw, str):
                DEFAULT_SETTINGS["tier_prices"] = json.loads(tier_prices_raw)
            else:
                DEFAULT_SETTINGS["tier_prices"] = tier_prices_raw
            DEFAULT_SETTINGS["vat"] = row.get('vat', 8)
            # Load email settings nếu có
            email_config = row.get('email_config')
            if email_config:
                if isinstance(email_config, str):
                    DEFAULT_SETTINGS["email"] = json.loads(email_config)
                else:
                    DEFAULT_SETTINGS["email"] = email_config
        db.close()
        print("✅ Settings loaded from database")
    except Exception as e:
        print(f"⚠️ Could not load settings from DB: {e}")

def send_email_alert(subject, message):
    """Gửi email cảnh báo"""
    global last_email_sent
    email_cfg = DEFAULT_SETTINGS.get("email", {})
    
    if not email_cfg.get("enabled"):
        return False, "Email alerts disabled"
    
    if not email_cfg.get("recipient") or not email_cfg.get("sender_email"):
        return False, "Email not configured"
    
    # Check cooldown
    if last_email_sent:
        elapsed = (datetime.now(VN_TIMEZONE) - last_email_sent).total_seconds()
        if elapsed < EMAIL_COOLDOWN:
            return False, f"Cooldown: {int(EMAIL_COOLDOWN - elapsed)}s remaining"
    
    try:
        msg = MIMEMultipart()
        msg['From'] = email_cfg['sender_email']
        msg['To'] = email_cfg['recipient']
        msg['Subject'] = f"⚡ {subject} - Hệ thống giám sát điện năng"
        
        body = f"""
        <html>
        <body style="font-family: Arial, sans-serif;">
            <h2 style="color: #e74c3c;">Cảnh báo hệ thống</h2>
            <p><strong>Thời gian:</strong> {datetime.now(VN_TIMEZONE).strftime('%d/%m/%Y %H:%M:%S')}</p>
            <p><strong>Nội dung:</strong></p>
            <div style="background: #f8f9fa; padding: 15px; border-left: 4px solid #e74c3c;">
                {message}
            </div>
            <hr>
            <p style="color: #666; font-size: 12px;">Đây là email tự động từ hệ thống giám sát điện năng HCMUTE.</p>
        </body>
        </html>
        """
        msg.attach(MIMEText(body, 'html', 'utf-8'))
        
        server = smtplib.SMTP(email_cfg.get('smtp_server', 'smtp.gmail.com'), 
                              email_cfg.get('smtp_port', 587))
        server.starttls()
        server.login(email_cfg['sender_email'], email_cfg['sender_password'])
        server.send_message(msg)
        server.quit()
        
        last_email_sent = datetime.now(VN_TIMEZONE)
        print(f"📧 Email sent to {email_cfg['recipient']}")
        return True, "Email sent successfully"
    except Exception as e:
        print(f" Email error: {e}")
        return False, str(e)

def get_db():
    return pymysql.connect(**DB_CONFIG)

@app.route('/api/data', methods=['GET'])
def get_all_data():
    """Lấy toàn bộ dữ liệu + kiểm tra timeout"""
    try:
        db = get_db()
        cur = db.cursor()
        
        # Lấy dữ liệu mới nhất của mỗi slave + tính seconds_ago
        # Dùng ABS để xử lý trường hợp timezone lệch
        cur.execute("""
            SELECT 
                m.slave_id, 
                m.reg, 
                m.value, 
                m.ts,
                UNIX_TIMESTAMP(NOW()) - UNIX_TIMESTAMP(m.ts) as seconds_ago
            FROM modbus_data m
            INNER JOIN (
                SELECT slave_id, MAX(ts) as max_ts
                FROM modbus_data
                GROUP BY slave_id
            ) latest ON m.slave_id = latest.slave_id 
                    AND m.ts = latest.max_ts
            ORDER BY m.slave_id, m.reg
        """)
        modbus_rows = cur.fetchall()
        
        # Lấy trạng thái điều khiển từ pending_commands
        cur.execute("SELECT slave_id, device0, device1 FROM pending_commands")
        pending_rows = cur.fetchall()
        pending_map = {row['slave_id']: row for row in pending_rows}
        
        # Xử lý dữ liệu modbus theo slave
        slave_data = {}
        slave_seconds_ago = {}
        for row in modbus_rows:
            sid = row['slave_id']
            if sid not in slave_data:
                slave_data[sid] = {}
                slave_seconds_ago[sid] = row['seconds_ago']
            slave_data[sid][row['reg']] = row['value']
        
        # Build rooms data
        rooms = {}
        total_power = 0
        total_energy = 0
        
        # Tính chi phí điện - load tier settings trước
        tier_prices = DEFAULT_SETTINGS["tier_prices"]
        tier_limits = DEFAULT_SETTINGS["tier_limits"]
        
        # Load room thresholds từ DB
        room_thresholds = {}
        try:
            cur.execute("SELECT room_thresholds FROM settings WHERE id = 1")
            row = cur.fetchone()
            if row and row.get('room_thresholds'):
                thresholds_data = row['room_thresholds']
                if isinstance(thresholds_data, str):
                    room_thresholds = json.loads(thresholds_data)
                else:
                    room_thresholds = thresholds_data
        except:
            pass
        
        # Danh sách phòng vượt ngưỡng
        rooms_over_threshold = []
        
        for slave_id, regs in slave_data.items():
            room_id = f"room{slave_id}"
            seconds_ago = slave_seconds_ago.get(slave_id, 9999)
            
            # Kiểm tra timeout: dùng ABS vì có thể timezone lệch
            is_timeout = abs(seconds_ago) > TIMEOUT_SECONDS
            
            # Parse sensor values
            voltage = regs.get(REG_VOLTAGE, 0) / 10.0
            current = regs.get(REG_CURRENT, 0) / 100.0
            power = regs.get(REG_POWER, 0)
            energy = regs.get(REG_ENERGY, 0) / 1000.0
            
            # Tính tiền điện cho phòng này
            room_cost = calculate_electricity_cost(energy, tier_limits, tier_prices)
            room_month_cost = calculate_electricity_cost(energy * 30, tier_limits, tier_prices)
            
            # Device states
            pending = pending_map.get(slave_id, {})
            dev0_state = pending.get('device0', regs.get(REG_DEVICE0, 0))
            dev1_state = pending.get('device1', regs.get(REG_DEVICE1, 0))
            
            room_name = ROOM_NAMES.get(slave_id, f"Phòng {slave_id}")
            
            rooms[room_id] = {
                "name": room_name,
                "power": power if not is_timeout else 0,
                "voltage": voltage,
                "current": current,
                "energy": energy,
                "cost": int(room_cost),
                "month_cost": int(room_month_cost),
                "timeout": is_timeout,
                "seconds_ago": int(seconds_ago),
                "devices": {
                    "device0": {"name": "Đèn", "state": bool(dev0_state)},
                    "device1": {"name": "Quạt", "state": bool(dev1_state)}
                }
            }
            
            # Check room threshold và ghi nhận nếu vượt
            if not is_timeout and room_id in room_thresholds:
                threshold = room_thresholds[room_id]
                warning_threshold = threshold.get('warning', 300)
                critical_threshold = threshold.get('critical', 500)
                
                if power >= critical_threshold:
                    rooms_over_threshold.append({
                        "name": room_name,
                        "power": power,
                        "threshold": critical_threshold,
                        "level": "critical"
                    })
                elif power >= warning_threshold:
                    rooms_over_threshold.append({
                        "name": room_name,
                        "power": power,
                        "threshold": warning_threshold,
                        "level": "warning"
                    })
            
            if not is_timeout:
                total_power += power
                total_energy += energy
        
        month_cost = calculate_electricity_cost(total_energy * 30, tier_limits, tier_prices)
        
        # ===== AUTO EMAIL ALERT CHECK =====
        # 1. Check tổng công suất (global threshold)
        warning_threshold = DEFAULT_SETTINGS["thresholds"]["warning"]
        critical_threshold = DEFAULT_SETTINGS["thresholds"]["critical"]
        
        if total_power >= critical_threshold:
            send_email_alert(
                "NGUY HIỂM - Quá tải nghiêm trọng",
                f"<p><strong>Tổng công suất: {total_power}W</strong> vượt ngưỡng nguy hiểm <strong>{critical_threshold}W</strong></p>"
                f"<p>Vui lòng kiểm tra và tắt bớt thiết bị ngay!</p>"
            )
        elif total_power >= warning_threshold:
            send_email_alert(
                "Cảnh báo - Công suất cao", 
                f"<p>Tổng công suất: <strong>{total_power}W</strong> vượt ngưỡng cảnh báo <strong>{warning_threshold}W</strong></p>"
                f"<p>Hãy theo dõi và cân nhắc tắt bớt thiết bị.</p>"
            )
        
        # 2. Check từng phòng vượt ngưỡng
        if rooms_over_threshold:
            critical_rooms = [r for r in rooms_over_threshold if r['level'] == 'critical']
            warning_rooms = [r for r in rooms_over_threshold if r['level'] == 'warning']
            
            if critical_rooms:
                room_details = "<br>".join([
                    f"• <strong>{r['name']}</strong>: {r['power']}W (ngưỡng: {r['threshold']}W)"
                    for r in critical_rooms
                ])
                send_email_alert(
                    f"NGUY HIỂM - {len(critical_rooms)} phòng quá tải",
                    f"<p>Các phòng sau đang vượt ngưỡng nguy hiểm:</p>"
                    f"<p>{room_details}</p>"
                    f"<p>Vui lòng kiểm tra và tắt bớt thiết bị ngay!</p>"
                )
            elif warning_rooms:
                room_details = "<br>".join([
                    f"• <strong>{r['name']}</strong>: {r['power']}W (ngưỡng: {r['threshold']}W)"
                    for r in warning_rooms
                ])
                send_email_alert(
                    f"Cảnh báo - {len(warning_rooms)} phòng công suất cao",
                    f"<p>Các phòng sau đang vượt ngưỡng cảnh báo:</p>"
                    f"<p>{room_details}</p>"
                    f"<p>Hãy theo dõi và cân nhắc tắt bớt thiết bị.</p>"
                )
        
        db.close()
        
        return jsonify({
            "rooms": rooms,
            "settings": DEFAULT_SETTINGS,
            "energy": {
                "current": {
                    "today_kwh": round(total_energy, 3),
                    "today_cost": int(calculate_electricity_cost(total_energy, tier_limits, tier_prices)),
                    "month_kwh": round(total_energy * 30, 1),
                    "month_cost": int(month_cost)
                }
            },
            "total": {"power": total_power, "monthly_cost": int(month_cost)}
        })
        
    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/chart/power', methods=['GET'])
def get_power_history():
    """Lấy lịch sử công suất cho đồ thị từ modbus_data"""
    try:
        period = request.args.get('period', 'day')
        print(f"📊 Chart request: period={period}")
        
        # Xác định khoảng thời gian và limit
        if period == 'week':
            time_filter = "ts >= DATE_SUB(NOW(), INTERVAL 7 DAY)"
            limit = 1000
        elif period == 'month':
            time_filter = "ts >= DATE_SUB(NOW(), INTERVAL 30 DAY)"
            limit = 2000
        else:  # day (24 giờ)
            time_filter = "ts >= DATE_SUB(NOW(), INTERVAL 24 HOUR)"
            limit = 500
        
        db = get_db()
        cur = db.cursor()
        
        # Lấy tất cả dữ liệu power trong khoảng thời gian
        query = f"""
            SELECT slave_id, value as power, ts
            FROM modbus_data
            WHERE reg = %s AND {time_filter}
            ORDER BY ts ASC
            LIMIT {limit}
        """
        print(f"📊 Query: {query}")
        cur.execute(query, (REG_POWER,))
        rows = cur.fetchall()
        print(f"📊 Found {len(rows)} rows")
        
        if not rows:
            db.close()
            return jsonify({"labels": [], "total_power": [], "period": period, "count": 0})
        
        # Nhóm theo timestamp và tính tổng power của tất cả slave
        power_by_time = {}
        for row in rows:
            # Format timestamp tùy theo period
            if period == 'month':
                ts_key = row['ts'].strftime("%d/%m %H:00")
            elif period == 'week':
                ts_key = row['ts'].strftime("%d/%m %H:%M")
            else:  # day
                ts_key = row['ts'].strftime("%H:%M:%S")
            
            ts_full = row['ts']
            if ts_key not in power_by_time:
                power_by_time[ts_key] = {"total": 0, "ts": ts_full}
            power_by_time[ts_key]["total"] += row['power']
        
        # Sắp xếp theo thời gian
        sorted_data = sorted(power_by_time.items(), key=lambda x: x[1]['ts'])
        
        labels = [item[0] for item in sorted_data]
        values = [item[1]['total'] for item in sorted_data]
        
        db.close()
        
        print(f"📊 Returning {len(labels)} data points")
        return jsonify({
            "labels": labels,
            "total_power": values,
            "period": period,
            "count": len(labels)
        })
        
    except Exception as e:
        print(f"❌ Error chart: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e), "labels": [], "total_power": []}), 500

def calculate_electricity_cost(kwh, limits, prices):
    """Tính tiền điện theo bậc thang"""
    cost = 0
    remaining = kwh
    
    tiers = [
        (limits['tier1'], prices[0]),
        (limits['tier2'] - limits['tier1'], prices[1]),
        (limits['tier3'] - limits['tier2'], prices[2]),
        (limits['tier4'] - limits['tier3'], prices[3]),
        (limits['tier5'] - limits['tier4'], prices[4]),
        (float('inf'), prices[5])
    ]
    
    for limit, price in tiers:
        if remaining <= 0:
            break
        usage = min(remaining, limit)
        cost += usage * price
        remaining -= usage
    
    return cost * 1.08  # + 8% VAT

@app.route('/api/device/toggle', methods=['POST'])
def toggle_device():
    """Bật/tắt thiết bị - cập nhật pending_commands với sync=1"""
    try:
        data = request.json
        room_id = data['room_id']  # "room5" hoặc "room7"
        device_id = data['device_id']  # "device0" hoặc "device1"
        state = 1 if data['state'] else 0
        
        # Parse slave_id từ room_id
        slave_id = int(room_id.replace('room', ''))
        device_num = int(device_id.replace('device', ''))
        
        db = get_db()
        cur = db.cursor()
        
        # Lấy trạng thái hiện tại
        cur.execute("SELECT device0, device1 FROM pending_commands WHERE slave_id = %s", (slave_id,))
        current = cur.fetchone()
        
        if current:
            # Update device state và set sync=1 để gửi lệnh
            if device_num == 0:
                cur.execute(
                    "UPDATE pending_commands SET device0 = %s, sync = 1 WHERE slave_id = %s",
                    (state, slave_id)
                )
            else:
                cur.execute(
                    "UPDATE pending_commands SET device1 = %s, sync = 1 WHERE slave_id = %s",
                    (state, slave_id)
                )
        else:
            # Insert mới
            dev0 = state if device_num == 0 else 0
            dev1 = state if device_num == 1 else 0
            cur.execute(
                "INSERT INTO pending_commands (slave_id, device0, device1, sync) VALUES (%s, %s, %s, 1)",
                (slave_id, dev0, dev1)
            )
        
        db.close()
        print(f"✅ Toggle: Slave {slave_id}, Device {device_num} -> {state}")
        return jsonify({"success": True})
        
    except Exception as e:
        print(f"Error toggle: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/settings/thresholds', methods=['POST'])
def save_thresholds():
    """Lưu ngưỡng cảnh báo vào database"""
    try:
        data = request.json
        warning = data['warning']
        critical = data['critical']
        
        DEFAULT_SETTINGS["thresholds"]["warning"] = warning
        DEFAULT_SETTINGS["thresholds"]["critical"] = critical
        
        # Lưu vào DB
        db = get_db()
        cur = db.cursor()
        cur.execute("""
            UPDATE settings SET threshold_warning = %s, threshold_critical = %s WHERE id = 1
        """, (warning, critical))
        db.close()
        
        print(f"✅ Thresholds saved to DB: warning={warning}, critical={critical}")
        return jsonify({"success": True})
    except Exception as e:
        print(f"❌ Error saving thresholds: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/settings/tiers', methods=['POST'])
def save_tiers():
    """Lưu giá điện bậc thang vào database"""
    try:
        data = request.json
        limits = data['limits']
        prices = data['prices']
        
        DEFAULT_SETTINGS["tier_limits"] = limits
        DEFAULT_SETTINGS["tier_prices"] = prices
        
        # Lưu vào DB
        db = get_db()
        cur = db.cursor()
        cur.execute("""
            UPDATE settings SET 
                tier_limit1 = %s, tier_limit2 = %s, tier_limit3 = %s, 
                tier_limit4 = %s, tier_limit5 = %s, tier_prices = %s 
            WHERE id = 1
        """, (limits['tier1'], limits['tier2'], limits['tier3'], 
              limits['tier4'], limits['tier5'], json.dumps(prices)))
        db.close()
        
        print(f"✅ Tier settings saved to DB")
        return jsonify({"success": True})
    except Exception as e:
        print(f"❌ Error saving tiers: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/settings/vat', methods=['POST'])
def save_vat():
    """Lưu thuế VAT vào database"""
    try:
        data = request.json
        vat = data['vat']
        DEFAULT_SETTINGS["vat"] = vat
        
        # Lưu vào DB
        db = get_db()
        cur = db.cursor()
        cur.execute("UPDATE settings SET vat = %s WHERE id = 1", (vat,))
        db.close()
        
        print(f"✅ VAT saved to DB: {vat}%")
        return jsonify({"success": True})
    except Exception as e:
        print(f"❌ Error saving VAT: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/settings/email', methods=['GET'])
def get_email_settings():
    """Lấy cấu hình email"""
    try:
        email_cfg = DEFAULT_SETTINGS.get("email", {})
        # Ẩn password khi trả về
        safe_cfg = {
            "enabled": email_cfg.get("enabled", False),
            "recipient": email_cfg.get("recipient", ""),
            "smtp_server": email_cfg.get("smtp_server", "smtp.gmail.com"),
            "smtp_port": email_cfg.get("smtp_port", 587),
            "sender_email": email_cfg.get("sender_email", ""),
            "has_password": bool(email_cfg.get("sender_password", "")),
            "cooldown_minutes": email_cfg.get("cooldown_minutes", 5),
            "daily_report_time": email_cfg.get("daily_report_time", "08:00")
        }
        return jsonify(safe_cfg)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/settings/email', methods=['POST'])
def save_email_settings():
    """Lưu cấu hình email vào database"""
    try:
        data = request.json
        
        email_cfg = DEFAULT_SETTINGS.get("email", {})
        email_cfg["enabled"] = data.get("enabled", False)
        email_cfg["recipient"] = data.get("recipient", "")
        email_cfg["smtp_server"] = data.get("smtp_server", "smtp.gmail.com")
        email_cfg["smtp_port"] = data.get("smtp_port", 587)
        email_cfg["sender_email"] = data.get("sender_email", "")
        
        # Chỉ cập nhật password nếu được gửi mới
        if data.get("sender_password"):
            email_cfg["sender_password"] = data["sender_password"]
        
        # Cooldown và Daily Report
        email_cfg["cooldown_minutes"] = data.get("cooldown_minutes", 5)
        email_cfg["daily_report_time"] = data.get("daily_report_time", "08:00")
        
        DEFAULT_SETTINGS["email"] = email_cfg
        
        # Lưu vào DB
        db = get_db()
        cur = db.cursor()
        # Kiểm tra cột email_config có tồn tại không, nếu không thì thêm
        try:
            cur.execute("UPDATE settings SET email_config = %s WHERE id = 1", (json.dumps(email_cfg),))
        except Exception:
            # Cột chưa tồn tại, thêm cột
            cur.execute("ALTER TABLE settings ADD COLUMN email_config JSON")
            cur.execute("UPDATE settings SET email_config = %s WHERE id = 1", (json.dumps(email_cfg),))
        db.close()
        
        print(f"✅ Email settings saved to DB")
        return jsonify({"success": True})
    except Exception as e:
        print(f"❌ Error saving email settings: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/email/test', methods=['POST'])
def test_email():
    """Gửi email test"""
    try:
        success, message = send_email_alert(
            "Test cấu hình email",
            "<p>Đây là email test từ hệ thống giám sát điện năng.</p><p>Nếu bạn nhận được email này, cấu hình đã hoạt động đúng!</p>"
        )
        if success:
            return jsonify({"success": True, "message": message})
        else:
            return jsonify({"success": False, "message": message}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/settings/room-thresholds', methods=['GET'])
def get_room_thresholds():
    """Lấy ngưỡng cảnh báo từng phòng"""
    try:
        db = get_db()
        cur = db.cursor()
        cur.execute("SELECT room_thresholds FROM settings WHERE id = 1")
        row = cur.fetchone()
        db.close()
        
        if row and row.get('room_thresholds'):
            thresholds = row['room_thresholds']
            if isinstance(thresholds, str):
                thresholds = json.loads(thresholds)
            return jsonify({"room_thresholds": thresholds})
        
        return jsonify({"room_thresholds": {}})
    except Exception as e:
        print(f"Error getting room thresholds: {e}")
        return jsonify({"room_thresholds": {}})

@app.route('/api/settings/room-thresholds', methods=['POST'])
def save_room_thresholds():
    """Lưu ngưỡng cảnh báo từng phòng vào database"""
    try:
        data = request.json
        room_thresholds = data.get('room_thresholds', {})
        
        db = get_db()
        cur = db.cursor()
        
        # Thử update, nếu cột chưa tồn tại thì thêm cột
        try:
            cur.execute("UPDATE settings SET room_thresholds = %s WHERE id = 1", 
                       (json.dumps(room_thresholds),))
        except Exception:
            cur.execute("ALTER TABLE settings ADD COLUMN room_thresholds JSON")
            cur.execute("UPDATE settings SET room_thresholds = %s WHERE id = 1", 
                       (json.dumps(room_thresholds),))
        
        db.close()
        print(f"✅ Room thresholds saved: {room_thresholds}")
        return jsonify({"success": True})
    except Exception as e:
        print(f"Error saving room thresholds: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/email/alert', methods=['POST'])
def trigger_email_alert():
    """Gửi email cảnh báo từ frontend"""
    try:
        data = request.json
        subject = data.get("subject", "Cảnh báo hệ thống")
        message = data.get("message", "Có cảnh báo từ hệ thống giám sát điện năng.")
        
        success, result = send_email_alert(subject, message)
        if success:
            return jsonify({"success": True, "message": result})
        else:
            return jsonify({"success": False, "message": result}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ASGI app cho uvicorn (phải định nghĩa sau khi app được tạo)
if _has_asgiref:
    asgi_app = WsgiToAsgi(app)
else:
    asgi_app = app  # Fallback, sẽ báo lỗi nếu chạy với uvicorn

# Load settings từ DB khi khởi động
try:
    load_settings_from_db()
except Exception as e:
    print(f"⚠️ Could not load settings on startup: {e}")

if __name__ == '__main__':
    print("🚀 API Server đang chạy tại http://localhost:5000")
    print("📊 Đọc dữ liệu từ: modbus_data")
    print("🎮 Điều khiển qua: pending_commands")
    print("📧 Email alerts: ", "Enabled" if DEFAULT_SETTINGS.get('email', {}).get('enabled') else "Disabled")
    app.run(host='0.0.0.0', port=5000, debug=True)
