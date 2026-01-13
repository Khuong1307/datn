// API Configuration - Kết nối MySQL qua Flask API
const API_BASE_URL = 'http://47.128.66.94:5000/api';

// API Helper Functions
const api = {
    // Lấy toàn bộ dữ liệu
    async getData() {
        const response = await fetch(`${API_BASE_URL}/data`);
        if (!response.ok) throw new Error('Failed to fetch data');
        return response.json();
    },

    // Lấy lịch sử công suất cho đồ thị (có filter theo thời gian)
    async getChartData(period = 'day') {
        const response = await fetch(`${API_BASE_URL}/chart/power?period=${period}`);
        if (!response.ok) throw new Error('Failed to fetch chart data');
        return response.json();
    },

    // Bật/tắt thiết bị
    async toggleDevice(roomId, deviceId, state) {
        const response = await fetch(`${API_BASE_URL}/device/toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_id: roomId, device_id: deviceId, state })
        });
        if (!response.ok) throw new Error('Failed to toggle device');
        return response.json();
    },

    // Lưu ngưỡng cảnh báo
    async saveThresholds(warning, critical) {
        const response = await fetch(`${API_BASE_URL}/settings/thresholds`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ warning, critical })
        });
        if (!response.ok) throw new Error('Failed to save thresholds');
        return response.json();
    },

    // Lưu giá điện bậc thang
    async saveTiers(limits, prices) {
        const response = await fetch(`${API_BASE_URL}/settings/tiers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limits, prices })
        });
        if (!response.ok) throw new Error('Failed to save tiers');
        return response.json();
    },

    // Lưu thuế VAT
    async saveVat(vat) {
        const response = await fetch(`${API_BASE_URL}/settings/vat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vat })
        });
        if (!response.ok) throw new Error('Failed to save VAT');
        return response.json();
    },

    // Lưu ngưỡng từng phòng
    async saveRoomThresholds(roomThresholds) {
        const response = await fetch(`${API_BASE_URL}/settings/room-thresholds`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_thresholds: roomThresholds })
        });
        if (!response.ok) throw new Error('Failed to save room thresholds');
        return response.json();
    },

    // Lấy ngưỡng từng phòng
    async getRoomThresholds() {
        const response = await fetch(`${API_BASE_URL}/settings/room-thresholds`);
        if (!response.ok) throw new Error('Failed to get room thresholds');
        return response.json();
    }
};

// Export for use in app.js
window.api = api;
window.API_BASE_URL = API_BASE_URL;
