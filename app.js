// Power Management App - MySQL API Version
let powerChart = null;
let distributionChart = null;
let lastUpdateTime = Date.now();
let refreshInterval = null;
let currentChartPeriod = 'realtime'; // realtime, day, week, month

// Lưu lịch sử công suất realtime (tối đa 60 điểm)
let powerHistory = [];
let timeLabels = [];
const MAX_HISTORY_POINTS = 60;
const REFRESH_INTERVAL = 2000; // 2 giây cho realtime

// Hàm tính thời gian tương đối
function getRelativeTime(timestamp) {
    const now = Date.now();
    const diff = Math.floor((now - timestamp) / 1000);

    if (diff < 5) return 'Ngay bây giờ';
    if (diff < 60) return `${diff} giây trước`;
    if (diff < 120) return '1 phút trước';
    if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
    if (diff < 7200) return '1 giờ trước';
    if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
    return `${Math.floor(diff / 86400)} ngày trước`;
}

// Hàm format thời gian hiện tại (HH:MM:SS)
function getCurrentTimeLabel() {
    const now = new Date();
    return now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Hàm format tiền tệ VNĐ
function formatCurrency(value) {
    return new Intl.NumberFormat('vi-VN').format(value);
}

document.addEventListener('DOMContentLoaded', function () {
    // Init navigation first (works on all pages)
    initNavigation();

    // These may not exist on all pages, so try-catch
    try { initCharts(); } catch (e) { console.log('Charts not on this page'); }
    try { initInfoModal(); } catch (e) { }
    try { initNotifications(); } catch (e) { }
    try { initEmailSettings(); } catch (e) { }
    try { initRoomThresholds(); } catch (e) { }
    try { initCustomCalculation(); } catch (e) { }

    // Tải dữ liệu lần đầu
    loadData();

    // Tự động refresh dữ liệu mỗi 3 giây
    refreshInterval = setInterval(loadData, REFRESH_INTERVAL);
});

// Tải dữ liệu từ API
async function loadData() {
    try {
        const data = await window.api.getData();

        if (data) {
            lastUpdateTime = Date.now();
            updateStats(data);
            renderRooms(data);
            renderTierList(data.settings);
            updateAlerts(data);

            // Nếu đang ở chế độ realtime, cập nhật đồ thị trực tiếp
            if (currentChartPeriod === 'realtime') {
                updateRealtimeChart(data);
            }

            // Cập nhật distribution chart
            updateDistributionChart(data);
        }
    } catch (error) {
        console.error('API error:', error);
        showOfflineMessage();
    }
}

// Cập nhật đồ thị realtime (theo giây)
function updateRealtimeChart(data) {
    if (!powerChart) return;

    const totalPower = data.total?.power || 0;
    const timeLabel = getCurrentTimeLabel();

    powerHistory.push(totalPower);
    timeLabels.push(timeLabel);

    if (powerHistory.length > MAX_HISTORY_POINTS) {
        powerHistory.shift();
        timeLabels.shift();
    }

    powerChart.data.labels = [...timeLabels];
    powerChart.data.datasets[0].data = [...powerHistory];
    powerChart.update('none');
}

// Cập nhật distribution chart
function updateDistributionChart(data) {
    if (!distributionChart || !data.rooms) return;

    const roomPowers = Object.values(data.rooms).map(r => r.timeout ? 0 : (r.power || 0));
    const roomNames = Object.values(data.rooms).map(r => r.name);
    distributionChart.data.labels = roomNames;
    distributionChart.data.datasets[0].data = roomPowers;
    distributionChart.update('none');
}

// Tải dữ liệu đồ thị lịch sử từ MySQL (day/week/month)
async function loadChartData(period) {
    if (period === 'realtime') {
        // Reset và bắt đầu thu thập realtime
        powerHistory = [];
        timeLabels = [];
        if (powerChart) {
            powerChart.data.labels = [];
            powerChart.data.datasets[0].data = [];
            powerChart.update();
        }
        return;
    }

    // Load dữ liệu lịch sử từ MySQL
    try {
        console.log('Loading chart data for period:', period);
        const chartData = await window.api.getChartData(period);
        console.log('Chart data received:', chartData);

        if (chartData && chartData.labels && chartData.labels.length > 0) {
            powerChart.data.labels = chartData.labels;
            powerChart.data.datasets[0].data = chartData.total_power;
            powerChart.update();
            console.log('Chart updated with', chartData.labels.length, 'points');
        } else {
            console.log('No chart data available');
        }
    } catch (e) {
        console.error('Error loading chart data:', e);
    }
}

// Update dashboard statistics
function updateStats(data) {
    const totalPowerEl = document.getElementById('totalPower');
    const monthlyCost = document.getElementById('monthlyCost');
    const activeRooms = document.getElementById('activeRooms');
    const monthlyEnergy = document.getElementById('monthlyEnergy');
    const todayKwh = document.getElementById('todayKwh');
    const todayCost = document.getElementById('todayCost');
    const monthKwh = document.getElementById('monthKwh');
    const monthCost = document.getElementById('monthCost');

    // Tính tổng công suất từ tất cả các phòng
    let calculatedTotalPower = 0;
    let active = 0;
    if (data.rooms) {
        Object.values(data.rooms).forEach(room => {
            calculatedTotalPower += room.power || 0;
            if (room.power > 0) active++;
        });
    }

    data.calculatedTotalPower = calculatedTotalPower;

    if (totalPowerEl) totalPowerEl.textContent = formatNumber(calculatedTotalPower);
    if (monthlyCost) monthlyCost.textContent = formatNumber(data.total?.monthly_cost || 0);
    if (monthlyEnergy) monthlyEnergy.textContent = formatNumber(data.energy?.current?.month_kwh || 0);
    if (activeRooms) activeRooms.textContent = active;

    if (data.energy?.current) {
        if (todayKwh) todayKwh.textContent = (data.energy.current.today_kwh || 0) + ' kWh';
        if (todayCost) todayCost.textContent = formatNumber(data.energy.current.today_cost || 0) + ' VNĐ';
        if (monthKwh) monthKwh.textContent = (data.energy.current.month_kwh || 0) + ' kWh';
        if (monthCost) monthCost.textContent = formatNumber(data.energy.current.month_cost || 0) + ' VNĐ';
    }

    // Update threshold inputs
    if (data.settings?.thresholds) {
        const warningInput = document.getElementById('warningThresholdInput');
        const criticalInput = document.getElementById('criticalThresholdInput');
        if (warningInput && !warningInput.matches(':focus')) warningInput.value = data.settings.thresholds.warning;
        if (criticalInput && !criticalInput.matches(':focus')) criticalInput.value = data.settings.thresholds.critical;
    }

    // Update VAT input
    const vatInput = document.getElementById('vatInput');
    if (vatInput && data.settings?.vat !== undefined && !vatInput.matches(':focus')) {
        vatInput.value = data.settings.vat;
    }
}

// Render rooms grid
function renderRooms(data) {
    const roomsGrid = document.getElementById('roomsGrid');
    if (!roomsGrid || !data.rooms) return;

    roomsGrid.innerHTML = '';

    Object.entries(data.rooms).forEach(([roomId, room]) => {
        const isActive = room.power > 0;
        const isTimeout = room.timeout === true;

        // Debug log
        console.log(`${room.name}: timeout=${room.timeout}, seconds_ago=${room.seconds_ago}`);

        const roomCard = document.createElement('div');
        roomCard.className = `room-card ${isTimeout ? 'timeout' : (isActive ? 'active' : 'inactive')}`;

        let devicesHtml = '';
        if (room.devices) {
            Object.entries(room.devices).forEach(([deviceId, device]) => {
                const icon = getDeviceIcon(device.name);
                devicesHtml += `
                    <div class="device-item ${device.state ? '' : 'off'}">
                        <div class="device-info">
                            <div class="device-icon"><i class="fas ${icon}"></i></div>
                            <div>
                                <div class="device-name">${device.name}</div>
                            </div>
                        </div>
                        <div class="device-toggle ${device.state ? 'on' : ''}" 
                             data-room="${roomId}" data-device="${deviceId}"></div>
                    </div>
                `;
            });
        }

        const voltage = room.voltage ?? 0;
        const current = room.current ?? 0;
        const energy = room.energy ?? 0;

        // Status text
        let statusText = isActive ? 'Đang hoạt động' : 'Không hoạt động';
        let statusClass = '';
        if (isTimeout) {
            statusText = `Mất kết nối (${room.seconds_ago}s)`;
            statusClass = 'timeout-status';
        }

        roomCard.innerHTML = `
            <div class="room-header">
                <div class="room-info">
                    <div class="room-icon"><i class="fas ${isTimeout ? 'fa-exclamation-triangle' : 'fa-door-open'}"></i></div>
                    <div>
                        <div class="room-name">${room.name}</div>
                        <div class="room-status ${statusClass}">
                            <span class="status-dot ${isTimeout ? 'timeout' : ''}"></span>
                            <span>${statusText}</span>
                        </div>
                    </div>
                </div>
                <div class="room-power ${isTimeout ? 'timeout-power' : ''}">
                    <div class="power-value">${isTimeout ? '---' : room.power}</div>
                    <div class="power-unit">Watts</div>
                </div>
            </div>
            <div class="room-metrics">
                <div class="metric-item voltage">
                    <div class="metric-icon"><i class="fas fa-bolt"></i></div>
                    <div class="metric-info">
                        <span class="metric-value">${isTimeout ? '---' : voltage.toFixed(1)}</span>
                        <span class="metric-label">Điện áp (V)</span>
                    </div>
                </div>
                <div class="metric-item current">
                    <div class="metric-icon"><i class="fas fa-wave-square"></i></div>
                    <div class="metric-info">
                        <span class="metric-value">${isTimeout ? '---' : current.toFixed(3)}</span>
                        <span class="metric-label">Dòng điện (A)</span>
                    </div>
                </div>
                <div class="metric-item energy">
                    <div class="metric-icon"><i class="fas fa-chart-line"></i></div>
                    <div class="metric-info">
                        <span class="metric-value">${isTimeout ? '---' : energy.toFixed(3)}</span>
                        <span class="metric-label">Điện năng (kWh)</span>
                    </div>
                </div>
                <div class="metric-item cost">
                    <div class="metric-icon"><i class="fas fa-money-bill-wave"></i></div>
                    <div class="metric-info">
                        <span class="metric-value">${isTimeout ? '---' : formatCurrency(room.month_cost || 0)}</span>
                        <span class="metric-label">Tiền/tháng (VNĐ)</span>
                    </div>
                </div>
            </div>

            <div class="room-devices">${devicesHtml}</div>
        `;

        roomsGrid.appendChild(roomCard);
    });

    // Re-attach device toggle listeners
    initDeviceControls();
}

// ===== Mobile Navigation Toggle =====
function initNavigation() {
    const navToggle = document.getElementById('navToggle');
    const navMenu = document.getElementById('navMenu');

    console.log('initNavigation called, toggle:', navToggle, 'menu:', navMenu);

    if (!navToggle || !navMenu) {
        console.log('Nav elements not found');
        return;
    }

    navToggle.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Toggle clicked!');
        navMenu.classList.toggle('active');
        // Change icon
        const icon = navToggle.querySelector('i');
        if (navMenu.classList.contains('active')) {
            icon.classList.remove('fa-bars');
            icon.classList.add('fa-times');
        } else {
            icon.classList.remove('fa-times');
            icon.classList.add('fa-bars');
        }
    });

    // Close menu when clicking a link
    navMenu.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', () => {
            navMenu.classList.remove('active');
            navToggle.querySelector('i').classList.remove('fa-times');
            navToggle.querySelector('i').classList.add('fa-bars');
        });
    });

    console.log('Navigation initialized');
}

// Device control - toggle state via API
function initDeviceControls() {
    document.querySelectorAll('.device-toggle').forEach(toggle => {
        toggle.addEventListener('click', async function () {
            const roomId = this.dataset.room;
            const deviceId = this.dataset.device;
            const isOn = this.classList.contains('on');
            const newState = !isOn;

            // Optimistic UI update
            this.classList.toggle('on');

            try {
                await window.api.toggleDevice(roomId, deviceId, newState);
            } catch (error) {
                console.error('Error toggling device:', error);
                // Revert on error
                this.classList.toggle('on');
                alert('Lỗi khi điều khiển thiết bị!');
            }
        });
    });
}

// Update alerts based on current data
async function updateAlerts(data) {
    const alertList = document.getElementById('alertList');
    if (!alertList || !data.settings?.thresholds) return;

    const warningThreshold = data.settings.thresholds.warning;
    const criticalThreshold = data.settings.thresholds.critical;
    const totalPower = data.calculatedTotalPower || 0;
    const currentTime = getRelativeTime(lastUpdateTime);

    let alertsHtml = '';
    let notifications = [];

    // Check tổng công suất với global threshold
    if (totalPower >= criticalThreshold) {
        alertsHtml += createAlert('critical', 'fa-bolt', 'Quá tải nghiêm trọng',
            `Tổng công suất ${totalPower}W vượt ngưỡng nguy hiểm ${criticalThreshold}W`, currentTime);
        notifications.push({
            type: 'critical', icon: 'fa-bolt', title: 'Quá tải nghiêm trọng',
            desc: `Tổng: ${totalPower}W > ${criticalThreshold}W`, time: currentTime
        });
    } else if (totalPower >= warningThreshold) {
        alertsHtml += createAlert('warning', 'fa-exclamation-circle', 'Công suất cao',
            `Tổng công suất ${totalPower}W vượt ngưỡng cảnh báo ${warningThreshold}W`, currentTime);
        notifications.push({
            type: 'warning', icon: 'fa-exclamation-circle', title: 'Công suất cao',
            desc: `Tổng: ${totalPower}W > ${warningThreshold}W`, time: currentTime
        });
    }

    // Load per-room thresholds và check từng phòng
    let roomThresholds = {};
    try {
        const thresholdsData = await window.api.getRoomThresholds();
        if (thresholdsData && thresholdsData.room_thresholds) {
            roomThresholds = thresholdsData.room_thresholds;
        }
    } catch (e) {
        console.log('Could not load room thresholds for alerts');
    }

    if (data.rooms) {
        Object.entries(data.rooms).forEach(([roomId, room]) => {
            // Kiểm tra ngưỡng riêng của phòng
            if (roomThresholds[roomId]) {
                const roomWarning = roomThresholds[roomId].warning || 300;
                const roomCritical = roomThresholds[roomId].critical || 500;

                if (room.power >= roomCritical) {
                    alertsHtml += createAlert('critical', 'fa-bolt', `${room.name} - Quá tải`,
                        `Công suất ${room.power}W vượt ngưỡng nguy hiểm ${roomCritical}W`, currentTime);
                    notifications.push({
                        type: 'critical', icon: 'fa-bolt', title: `${room.name} quá tải`,
                        desc: `${room.power}W > ${roomCritical}W`, time: currentTime
                    });
                } else if (room.power >= roomWarning) {
                    alertsHtml += createAlert('warning', 'fa-exclamation-circle', `${room.name} - Công suất cao`,
                        `Công suất ${room.power}W vượt ngưỡng cảnh báo ${roomWarning}W`, currentTime);
                    notifications.push({
                        type: 'warning', icon: 'fa-exclamation-circle', title: `${room.name} công suất cao`,
                        desc: `${room.power}W > ${roomWarning}W`, time: currentTime
                    });
                }
            }
        });
    }

    let inactiveRooms = [];
    if (data.rooms) {
        Object.values(data.rooms).forEach(room => {
            if (room.power === 0) inactiveRooms.push(room.name);
        });
    }

    if (inactiveRooms.length > 0) {
        alertsHtml += createAlert('info', 'fa-info-circle', 'Phòng không hoạt động',
            `${inactiveRooms.join(', ')} không có thiết bị đang bật`, currentTime);
    }

    if (alertsHtml === '') {
        alertsHtml = createAlert('info', 'fa-check-circle', 'Hệ thống bình thường',
            'Tất cả các chỉ số đều trong ngưỡng cho phép', currentTime);
    }

    alertList.innerHTML = alertsHtml;
    updateNotificationDropdown(notifications);
}

function createAlert(type, icon, title, desc, time) {
    return `
        <div class="alert-item ${type}">
            <div class="alert-icon"><i class="fas ${icon}"></i></div>
            <div class="alert-content">
                <span class="alert-title">${title}</span>
                <span class="alert-desc">${desc}</span>
            </div>
            <span class="alert-time">${time}</span>
        </div>
    `;
}

// Update tier form with values from API
function renderTierList(settings) {
    if (!settings) return;

    const limits = settings.tier_limits;
    const prices = settings.tier_prices;
    if (!limits || !prices) return;

    // Update limit inputs (only if not focused)
    const inputs = ['tierLimit1', 'tierLimit2', 'tierLimit3', 'tierLimit4', 'tierLimit5'];
    const limitValues = [limits.tier1, limits.tier2, limits.tier3, limits.tier4, limits.tier5];

    inputs.forEach((id, i) => {
        const el = document.getElementById(id);
        if (el && !el.matches(':focus')) el.value = limitValues[i];
    });

    // Update price inputs
    for (let i = 1; i <= 6; i++) {
        const el = document.getElementById(`tierPrice${i}`);
        if (el && !el.matches(':focus') && prices[i - 1]) el.value = prices[i - 1];
    }

    updateTierDisplayLabels();
    initTierSaveButton();
}

function updateTierDisplayLabels() {
    const limit1 = parseInt(document.getElementById('tierLimit1')?.value) || 50;
    const limit2 = parseInt(document.getElementById('tierLimit2')?.value) || 100;
    const limit3 = parseInt(document.getElementById('tierLimit3')?.value) || 200;
    const limit4 = parseInt(document.getElementById('tierLimit4')?.value) || 300;
    const limit5 = parseInt(document.getElementById('tierLimit5')?.value) || 400;

    const displays = {
        'tierLimit1Display': limit1 + 1,
        'tierLimit2Display': limit2 + 1,
        'tierLimit3Display': limit3 + 1,
        'tierLimit4Display': limit4 + 1,
        'tierLimit5Display': limit5
    };

    Object.entries(displays).forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    });
}

// Initialize save buttons
let tierSaveInitialized = false;
let thresholdSaveInitialized = false;
let vatSaveInitialized = false;
let pendingSaveType = null;

function initTierSaveButton() {
    if (tierSaveInitialized) return;
    tierSaveInitialized = true;

    document.querySelectorAll('.tier-limit-input').forEach(input => {
        input.addEventListener('input', updateTierDisplayLabels);
    });

    document.getElementById('saveTierBtn')?.addEventListener('click', () => showGenericConfirmModal('tier'));

    const confirmBtn = document.getElementById('modalConfirmBtn');
    const cancelBtn = document.getElementById('modalCancelBtn');
    const modal = document.getElementById('confirmModal');

    if (confirmBtn && !confirmBtn.hasAttribute('data-initialized')) {
        confirmBtn.setAttribute('data-initialized', 'true');
        confirmBtn.addEventListener('click', handleConfirmSave);
    }

    if (cancelBtn && !cancelBtn.hasAttribute('data-initialized')) {
        cancelBtn.setAttribute('data-initialized', 'true');
        cancelBtn.addEventListener('click', hideConfirmModal);
    }

    if (modal && !modal.hasAttribute('data-initialized')) {
        modal.setAttribute('data-initialized', 'true');
        modal.addEventListener('click', (e) => {
            if (e.target === modal) hideConfirmModal();
        });
    }

    // Init threshold and VAT save
    initThresholdSave();
    initVatSave();
}

function initThresholdSave() {
    if (thresholdSaveInitialized) return;
    thresholdSaveInitialized = true;
    document.getElementById('saveThresholdBtn')?.addEventListener('click', () => showGenericConfirmModal('threshold'));
}

function initVatSave() {
    if (vatSaveInitialized) return;
    vatSaveInitialized = true;
    document.getElementById('saveVatBtn')?.addEventListener('click', () => showGenericConfirmModal('vat'));
}

function hideConfirmModal() {
    document.getElementById('confirmModal')?.classList.remove('active');
}

// Execute save functions using API
async function executeSaveTierSettings() {
    const saveBtn = document.getElementById('saveTierBtn');

    const tierLimits = {
        tier1: parseInt(document.getElementById('tierLimit1')?.value) || 50,
        tier2: parseInt(document.getElementById('tierLimit2')?.value) || 100,
        tier3: parseInt(document.getElementById('tierLimit3')?.value) || 200,
        tier4: parseInt(document.getElementById('tierLimit4')?.value) || 300,
        tier5: parseInt(document.getElementById('tierLimit5')?.value) || 400
    };

    const tierPrices = [
        parseInt(document.getElementById('tierPrice1')?.value) || 1984,
        parseInt(document.getElementById('tierPrice2')?.value) || 2050,
        parseInt(document.getElementById('tierPrice3')?.value) || 2380,
        parseInt(document.getElementById('tierPrice4')?.value) || 2998,
        parseInt(document.getElementById('tierPrice5')?.value) || 3350,
        parseInt(document.getElementById('tierPrice6')?.value) || 3460
    ];

    saveBtn.classList.add('saving');
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang lưu...';

    try {
        await window.api.saveTiers(tierLimits, tierPrices);
        saveBtn.classList.remove('saving');
        saveBtn.innerHTML = '<i class="fas fa-check"></i> Đã lưu!';
        showSaveStatus('success', '✓ Đã lưu thay đổi thành công!');
        setTimeout(() => { saveBtn.innerHTML = '<i class="fas fa-save"></i> Lưu thay đổi'; }, 2000);
    } catch (error) {
        console.error('Error saving tier settings:', error);
        saveBtn.classList.remove('saving');
        saveBtn.innerHTML = '<i class="fas fa-save"></i> Lưu thay đổi';
        showSaveStatus('error', '✗ Lỗi khi lưu. Vui lòng thử lại!');
    }
}

async function executeThresholdSave() {
    const saveBtn = document.getElementById('saveThresholdBtn');
    const warningValue = parseInt(document.getElementById('warningThresholdInput')?.value) || 500;
    const criticalValue = parseInt(document.getElementById('criticalThresholdInput')?.value) || 1000;

    if (warningValue >= criticalValue) {
        showStatusMessage('thresholdSaveStatus', 'error', 'Lỗi: Ngưỡng cảnh báo phải nhỏ hơn ngưỡng nguy hiểm!');
        return;
    }

    saveBtn.classList.add('saving');
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang lưu...';

    try {
        await window.api.saveThresholds(warningValue, criticalValue);
        saveBtn.classList.remove('saving');
        saveBtn.innerHTML = '<i class="fas fa-check"></i> Đã lưu!';
        showStatusMessage('thresholdSaveStatus', 'success', '✓ Đã lưu ngưỡng cảnh báo!');
        setTimeout(() => { saveBtn.innerHTML = '<i class="fas fa-save"></i> Lưu ngưỡng'; }, 2000);
    } catch (error) {
        console.error('Error saving thresholds:', error);
        saveBtn.classList.remove('saving');
        saveBtn.innerHTML = '<i class="fas fa-save"></i> Lưu ngưỡng';
        showStatusMessage('thresholdSaveStatus', 'error', '✗ Lỗi khi lưu!');
    }
}

async function executeVatSave() {
    const saveBtn = document.getElementById('saveVatBtn');
    const vatValue = parseInt(document.getElementById('vatInput')?.value) || 8;

    if (vatValue < 0 || vatValue > 100) {
        showStatusMessage('vatSaveStatus', 'error', 'Lỗi: Thuế VAT phải từ 0 đến 100!');
        return;
    }

    saveBtn.classList.add('saving');
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang lưu...';

    try {
        await window.api.saveVat(vatValue);
        saveBtn.classList.remove('saving');
        saveBtn.innerHTML = '<i class="fas fa-check"></i> Đã lưu!';
        showStatusMessage('vatSaveStatus', 'success', '✓ Đã lưu thuế VAT!');
        setTimeout(() => { saveBtn.innerHTML = '<i class="fas fa-save"></i> Lưu thuế VAT'; }, 2000);
    } catch (error) {
        console.error('Error saving VAT:', error);
        saveBtn.classList.remove('saving');
        saveBtn.innerHTML = '<i class="fas fa-save"></i> Lưu thuế VAT';
        showStatusMessage('vatSaveStatus', 'error', '✗ Lỗi khi lưu!');
    }
}

function showSaveStatus(type, message) {
    const saveStatus = document.getElementById('saveStatus');
    if (!saveStatus) return;
    saveStatus.className = 'save-status ' + type;
    saveStatus.textContent = message;
    setTimeout(() => { saveStatus.className = 'save-status'; saveStatus.textContent = ''; }, 3000);
}

function showStatusMessage(elementId, type, message) {
    const element = document.getElementById(elementId);
    if (!element) return;
    element.className = 'save-status ' + type;
    element.textContent = message;
    setTimeout(() => { element.className = 'save-status'; element.textContent = ''; }, 3000);
}

function showGenericConfirmModal(type) {
    pendingSaveType = type;
    const modal = document.getElementById('confirmModal');
    const title = document.querySelector('.modal-title');
    const message = document.querySelector('.modal-message');

    if (type === 'threshold') {
        const warningValue = parseInt(document.getElementById('warningThresholdInput')?.value) || 500;
        const criticalValue = parseInt(document.getElementById('criticalThresholdInput')?.value) || 1000;
        if (warningValue >= criticalValue) {
            showStatusMessage('thresholdSaveStatus', 'error', 'Lỗi: Ngưỡng cảnh báo phải nhỏ hơn ngưỡng nguy hiểm!');
            return;
        }
        if (title) title.textContent = 'Xác nhận lưu ngưỡng cảnh báo';
        if (message) message.textContent = 'Bạn có chắc chắn muốn lưu các thay đổi ngưỡng cảnh báo?';
    } else if (type === 'vat') {
        const vatValue = parseInt(document.getElementById('vatInput')?.value) || 8;
        if (vatValue < 0 || vatValue > 100) {
            showStatusMessage('vatSaveStatus', 'error', 'Lỗi: Thuế VAT phải từ 0 đến 100!');
            return;
        }
        if (title) title.textContent = 'Xác nhận lưu thuế VAT';
        if (message) message.textContent = 'Bạn có chắc chắn muốn lưu thay đổi thuế VAT?';
    } else if (type === 'tier') {
        const tierLimits = {
            tier1: parseInt(document.getElementById('tierLimit1')?.value) || 50,
            tier2: parseInt(document.getElementById('tierLimit2')?.value) || 100,
            tier3: parseInt(document.getElementById('tierLimit3')?.value) || 200,
            tier4: parseInt(document.getElementById('tierLimit4')?.value) || 300,
            tier5: parseInt(document.getElementById('tierLimit5')?.value) || 400
        };
        if (tierLimits.tier1 >= tierLimits.tier2 || tierLimits.tier2 >= tierLimits.tier3 ||
            tierLimits.tier3 >= tierLimits.tier4 || tierLimits.tier4 >= tierLimits.tier5) {
            showSaveStatus('error', 'Lỗi: Ngưỡng kWh phải tăng dần!');
            return;
        }
        if (title) title.textContent = 'Xác nhận lưu giá điện';
        if (message) message.textContent = 'Bạn có chắc chắn muốn lưu các thay đổi giá điện bậc thang?';
    }

    if (modal) modal.classList.add('active');
}

function handleConfirmSave() {
    hideConfirmModal();
    if (pendingSaveType === 'threshold') executeThresholdSave();
    else if (pendingSaveType === 'vat') executeVatSave();
    else if (pendingSaveType === 'tier') executeSaveTierSettings();
    pendingSaveType = null;
}

// Initialize Charts
function initCharts() {
    initPowerChart();
    initDistributionChart();
}

// Cập nhật đồ thị từ API data (cho day/week/month)
function updateChartsFromAPI(chartData, roomData) {
    if (powerChart && chartData) {
        powerChart.data.labels = chartData.labels || [];
        powerChart.data.datasets[0].data = chartData.total_power || [];
        powerChart.update('none');
    }

    if (distributionChart && roomData?.rooms) {
        const roomPowers = Object.values(roomData.rooms).map(r => r.timeout ? 0 : r.power);
        const roomNames = Object.values(roomData.rooms).map(r => r.name);
        distributionChart.data.labels = roomNames;
        distributionChart.data.datasets[0].data = roomPowers;
        distributionChart.update('none');
    }
}

function updateCharts(data) {
    // Fallback - không dùng nữa
}


function initPowerChart() {
    const ctx = document.getElementById('powerChart');
    if (!ctx) return;

    const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(99, 137, 255, 0.4)');
    gradient.addColorStop(0.5, 'rgba(99, 137, 255, 0.15)');
    gradient.addColorStop(1, 'rgba(99, 137, 255, 0)');

    powerChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timeLabels,
            datasets: [{
                label: 'Công suất (W)',
                data: powerHistory,
                borderColor: 'rgb(99, 137, 255)',
                backgroundColor: gradient,
                fill: true,
                tension: 0.4,
                borderWidth: 3,
                pointRadius: 0,
                pointHoverRadius: 8,
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: 'rgb(99, 137, 255)',
                pointHoverBorderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 1000, easing: 'easeOutQuart' },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15, 17, 25, 0.95)',
                    titleColor: '#fff',
                    bodyColor: 'rgba(255,255,255,0.8)',
                    borderColor: 'rgba(99, 137, 255, 0.5)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: false,
                    callbacks: {
                        title: (items) => `${items[0].label}`,
                        label: (item) => `⚡ Công suất: ${item.raw.toLocaleString()} W`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.03)', drawBorder: false },
                    ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 11 }, maxRotation: 0 }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                    ticks: {
                        color: 'rgba(255,255,255,0.5)',
                        font: { size: 11 },
                        callback: (value) => value.toLocaleString() + ' W'
                    },
                    beginAtZero: true
                }
            },
            interaction: { intersect: false, mode: 'index' }
        }
    });
}

function initDistributionChart() {
    const ctx = document.getElementById('distributionChart');
    if (!ctx) return;

    const roomNames = ['Phòng 1', 'Phòng 2', 'Phòng 3', 'Phòng 4'];
    const roomPowers = [0, 0, 0, 0];
    const colors = [
        'rgba(99, 137, 255, 0.9)',
        'rgba(46, 213, 137, 0.9)',
        'rgba(251, 191, 36, 0.9)',
        'rgba(239, 83, 80, 0.9)'
    ];

    const centerTextPlugin = {
        id: 'centerText',
        beforeDraw: function (chart) {
            const ctx = chart.ctx;
            const centerX = (chart.chartArea.left + chart.chartArea.right) / 2;
            const centerY = (chart.chartArea.top + chart.chartArea.bottom) / 2;
            const total = chart.data.datasets[0].data.reduce((a, b) => a + b, 0);

            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = 'bold 24px Inter, sans-serif';
            ctx.fillStyle = '#fff';
            ctx.fillText(total.toLocaleString() + 'W', centerX, centerY - 8);
            ctx.font = '12px Inter, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.fillText('Tổng công suất', centerX, centerY + 15);
            ctx.restore();
        }
    };

    distributionChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: roomNames,
            datasets: [{
                data: roomPowers,
                backgroundColor: colors,
                hoverBackgroundColor: colors.map(c => c.replace('0.9', '1')),
                borderWidth: 2,
                borderColor: 'rgba(15, 17, 25, 0.8)',
                hoverBorderColor: '#fff',
                hoverOffset: 15,
                spacing: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            animation: { animateRotate: true, animateScale: true, duration: 1000, easing: 'easeOutQuart' },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: 'rgba(255,255,255,0.8)', padding: 20, usePointStyle: true, pointStyle: 'circle', font: { size: 12, weight: '500' } }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 17, 25, 0.95)',
                    titleColor: '#fff',
                    bodyColor: 'rgba(255,255,255,0.8)',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 14,
                    cornerRadius: 10,
                    callbacks: {
                        label: function (context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const value = context.raw;
                            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                            return `⚡ ${value.toLocaleString()} W (${percentage}%)`;
                        }
                    }
                }
            }
        },
        plugins: [centerTextPlugin]
    });
}

// Navigation
function initNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', function () {
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            this.classList.add('active');
        });
    });

    // Xử lý nút chọn khoảng thời gian đồ thị
    document.querySelectorAll('.btn-icon[data-period]').forEach(btn => {
        btn.addEventListener('click', async function () {
            document.querySelectorAll('.btn-icon[data-period]').forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            currentChartPeriod = this.dataset.period; // realtime, day, week, month

            // Load chart data theo period
            await loadChartData(currentChartPeriod);
        });
    });

    document.querySelector('.btn-outline')?.addEventListener('click', function () {
        this.querySelector('i').classList.add('fa-spin');
        loadData();
        setTimeout(() => this.querySelector('i').classList.remove('fa-spin'), 1000);
    });
}

function showOfflineMessage() {
    console.log('Không thể kết nối API. Vui lòng kiểm tra server.');
}

// Utilities
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function getDeviceIcon(name) {
    const icons = { 'Đèn': 'fa-lightbulb', 'Quạt': 'fa-fan', 'Điều hòa': 'fa-snowflake' };
    return icons[name] || 'fa-plug';
}

// Info Modal
function initInfoModal() {
    const infoBtn = document.getElementById('infoBtn');
    const infoModal = document.getElementById('infoModal');
    const infoModalClose = document.getElementById('infoModalClose');

    if (infoBtn && infoModal) {
        infoBtn.addEventListener('click', () => infoModal.classList.add('active'));
        infoModalClose?.addEventListener('click', () => infoModal.classList.remove('active'));
        infoModal.addEventListener('click', (e) => { if (e.target === infoModal) infoModal.classList.remove('active'); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && infoModal.classList.contains('active')) infoModal.classList.remove('active'); });
    }
}

// Notification Dropdown
function initNotifications() {
    const bellBtn = document.getElementById('notificationBell');
    const dropdown = document.getElementById('notificationDropdown');
    const wrapper = document.getElementById('notificationWrapper');

    if (bellBtn && dropdown) {
        bellBtn.addEventListener('click', (e) => { e.stopPropagation(); dropdown.classList.toggle('active'); });
        document.addEventListener('click', (e) => { if (!wrapper.contains(e.target)) dropdown.classList.remove('active'); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dropdown.classList.remove('active'); });
    }
}

function updateNotificationDropdown(notifications) {
    const notifList = document.getElementById('notificationList');
    const notifBadge = document.getElementById('notificationBadge');
    const notifCount = document.getElementById('notificationCount');

    if (!notifList) return;

    const count = notifications.length;

    if (notifBadge) {
        notifBadge.textContent = count;
        notifBadge.classList.toggle('hidden', count === 0);
    }

    if (notifCount) notifCount.textContent = count > 0 ? `${count} cảnh báo` : 'Không có cảnh báo';

    if (count === 0) {
        notifList.innerHTML = `<div class="notification-empty"><i class="fas fa-check-circle"></i><p>Hệ thống bình thường</p></div>`;
    } else {
        notifList.innerHTML = notifications.map(n => `
            <div class="notification-item ${n.type}">
                <div class="notif-icon"><i class="fas ${n.icon}"></i></div>
                <div class="notif-content">
                    <div class="notif-title">${n.title}</div>
                    <div class="notif-desc">${n.desc}</div>
                    <div class="notif-time">${n.time}</div>
                </div>
            </div>
        `).join('');
    }
}

// ===== EMAIL SETTINGS =====
function initEmailSettings() {
    const emailToggle = document.getElementById('emailEnabled');
    const configSection = document.getElementById('emailConfigSection');
    const saveBtn = document.getElementById('saveEmailBtn');
    const testBtn = document.getElementById('testEmailBtn');
    const statusEl = document.getElementById('emailSaveStatus');

    if (!emailToggle || !configSection) return; // Không phải trang settings

    // Toggle show/hide config section
    emailToggle.addEventListener('change', function () {
        if (this.checked) {
            configSection.classList.add('show');
        } else {
            configSection.classList.remove('show');
        }
    });

    // Load email settings từ API
    loadEmailSettings();

    // Save button
    if (saveBtn) {
        saveBtn.addEventListener('click', saveEmailSettings);
    }

    // Test button
    if (testBtn) {
        testBtn.addEventListener('click', testEmailAlert);
    }
}

async function loadEmailSettings() {
    try {
        const response = await fetch(`${window.API_BASE_URL}/settings/email`);
        if (response.ok) {
            const data = await response.json();
            const emailToggle = document.getElementById('emailEnabled');
            const configSection = document.getElementById('emailConfigSection');

            if (data.enabled) {
                emailToggle.checked = true;
                configSection.classList.add('show');
            }

            document.getElementById('emailRecipient').value = data.recipient || '';
            document.getElementById('senderEmail').value = data.sender_email || '';
            document.getElementById('smtpServer').value = data.smtp_server || 'smtp.gmail.com';
            document.getElementById('smtpPort').value = data.smtp_port || 587;
            // Cooldown và Daily Report
            if (document.getElementById('alertCooldown')) {
                document.getElementById('alertCooldown').value = data.cooldown_minutes || 5;
            }
            if (document.getElementById('dailyReportTime')) {
                document.getElementById('dailyReportTime').value = data.daily_report_time || '08:00';
            }
            // Password không load về frontend vì security
        }
    } catch (e) {
        console.log('Could not load email settings:', e);
    }
}

async function saveEmailSettings() {
    const statusEl = document.getElementById('emailSaveStatus');
    const data = {
        enabled: document.getElementById('emailEnabled').checked,
        recipient: document.getElementById('emailRecipient').value,
        sender_email: document.getElementById('senderEmail').value,
        sender_password: document.getElementById('senderPassword').value,
        smtp_server: document.getElementById('smtpServer').value,
        smtp_port: parseInt(document.getElementById('smtpPort').value) || 587,
        cooldown_minutes: parseInt(document.getElementById('alertCooldown')?.value) || 5,
        daily_report_time: document.getElementById('dailyReportTime')?.value || '08:00'
    };

    try {
        statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang lưu...';
        statusEl.className = 'save-status';

        const response = await fetch(`${window.API_BASE_URL}/settings/email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            statusEl.innerHTML = '<i class="fas fa-check"></i> Đã lưu!';
            statusEl.className = 'save-status success';
        } else {
            throw new Error('Save failed');
        }
    } catch (e) {
        statusEl.innerHTML = '<i class="fas fa-times"></i> Lỗi lưu!';
        statusEl.className = 'save-status error';
    }

    setTimeout(() => { statusEl.innerHTML = ''; }, 3000);
}

async function testEmailAlert() {
    const statusEl = document.getElementById('emailSaveStatus');

    try {
        statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang gửi test...';
        statusEl.className = 'save-status';

        const response = await fetch(`${window.API_BASE_URL}/email/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const result = await response.json();

        if (result.success) {
            statusEl.innerHTML = '<i class="fas fa-check"></i> Email đã gửi!';
            statusEl.className = 'save-status success';
        } else {
            statusEl.innerHTML = '<i class="fas fa-times"></i> ' + (result.message || 'Gửi thất bại');
            statusEl.className = 'save-status error';
        }
    } catch (e) {
        statusEl.innerHTML = '<i class="fas fa-times"></i> Lỗi gửi email!';
        statusEl.className = 'save-status error';
    }

    setTimeout(() => { statusEl.innerHTML = ''; }, 5000);
}

// ===== Room Thresholds Settings =====
function initRoomThresholds() {
    const saveBtn = document.getElementById('saveRoomThresholdBtn');

    // Load room thresholds from API
    loadRoomThresholds();

    // Save button
    if (saveBtn) {
        saveBtn.addEventListener('click', saveRoomThresholds);
    }
}

async function loadRoomThresholds() {
    const container = document.getElementById('roomThresholdForm');
    if (!container) return;

    try {
        // Load rooms data from main API
        const data = await window.api.getData();

        if (!data || !data.rooms || Object.keys(data.rooms).length === 0) {
            container.innerHTML = `
                <div class="room-threshold-empty">
                    <i class="fas fa-info-circle"></i>
                    <span>Chưa có phòng nào trong hệ thống</span>
                </div>
            `;
            return;
        }

        // Load thresholds data
        let thresholdsData = {};
        try {
            const thresholdsResponse = await window.api.getRoomThresholds();
            if (thresholdsResponse && thresholdsResponse.room_thresholds) {
                thresholdsData = thresholdsResponse.room_thresholds;
            }
        } catch (e) {
            console.log('No existing room thresholds');
        }

        // Room colors for icons
        const roomColors = ['#6389ff', '#2ed589', '#fbbf24', '#ef5350', '#a855f7', '#ec4899'];

        // Generate HTML for each room
        let html = '';
        let index = 0;

        for (const [roomId, room] of Object.entries(data.rooms)) {
            const roomName = room.name || `Phòng ${roomId}`;
            const warning = thresholdsData[roomId]?.warning || 300;
            const critical = thresholdsData[roomId]?.critical || 500;
            const color = roomColors[index % roomColors.length];

            html += `
                <div class="room-threshold-row" data-room-id="${roomId}">
                    <div class="room-threshold-info">
                        <i class="fas fa-door-open room-icon" style="color: ${color}"></i>
                        <span class="room-threshold-name">${roomName}</span>
                    </div>
                    <div class="room-threshold-inputs">
                        <div class="room-input-group">
                            <label>Cảnh báo</label>
                            <input type="number" class="room-threshold-input warning-input" value="${warning}" min="0">
                            <span class="input-unit">W</span>
                        </div>
                        <div class="room-input-group">
                            <label>Nguy hiểm</label>
                            <input type="number" class="room-threshold-input critical-input" value="${critical}" min="0">
                            <span class="input-unit">W</span>
                        </div>
                    </div>
                </div>
            `;
            index++;
        }

        container.innerHTML = html;

    } catch (e) {
        console.error('Error loading room thresholds:', e);
        container.innerHTML = `
            <div class="room-threshold-empty error">
                <i class="fas fa-exclamation-circle"></i>
                <span>Không thể tải danh sách phòng</span>
            </div>
        `;
    }
}

async function saveRoomThresholds() {
    const statusEl = document.getElementById('roomThresholdSaveStatus');
    const saveBtn = document.getElementById('saveRoomThresholdBtn');
    const container = document.getElementById('roomThresholdForm');

    if (!container) return;

    const roomThresholds = {};
    const rows = container.querySelectorAll('.room-threshold-row');

    for (const row of rows) {
        const roomId = row.dataset.roomId;
        const roomName = row.querySelector('.room-threshold-name')?.textContent || roomId;
        const warningInput = row.querySelector('.warning-input');
        const criticalInput = row.querySelector('.critical-input');

        const warning = parseInt(warningInput?.value) || 300;
        const critical = parseInt(criticalInput?.value) || 500;

        // Validate
        if (warning >= critical) {
            if (statusEl) {
                statusEl.innerHTML = `<i class="fas fa-times"></i> ${roomName}: Ngưỡng cảnh báo phải nhỏ hơn ngưỡng nguy hiểm!`;
                statusEl.className = 'save-status error';
                setTimeout(() => { statusEl.innerHTML = ''; }, 3000);
            }
            return;
        }

        roomThresholds[roomId] = { warning, critical };
    }

    if (Object.keys(roomThresholds).length === 0) {
        if (statusEl) {
            statusEl.innerHTML = '<i class="fas fa-info-circle"></i> Không có phòng nào để lưu';
            statusEl.className = 'save-status';
            setTimeout(() => { statusEl.innerHTML = ''; }, 2000);
        }
        return;
    }

    try {
        if (saveBtn) {
            saveBtn.classList.add('saving');
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang lưu...';
        }
        if (statusEl) {
            statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang lưu...';
            statusEl.className = 'save-status';
        }

        await window.api.saveRoomThresholds(roomThresholds);

        if (saveBtn) {
            saveBtn.classList.remove('saving');
            saveBtn.innerHTML = '<i class="fas fa-check"></i> Đã lưu!';
            setTimeout(() => { saveBtn.innerHTML = '<i class="fas fa-save"></i> Lưu ngưỡng phòng'; }, 2000);
        }
        if (statusEl) {
            statusEl.innerHTML = '<i class="fas fa-check"></i> Đã lưu ngưỡng phòng!';
            statusEl.className = 'save-status success';
        }
    } catch (e) {
        console.error('Error saving room thresholds:', e);
        if (saveBtn) {
            saveBtn.classList.remove('saving');
            saveBtn.innerHTML = '<i class="fas fa-save"></i> Lưu ngưỡng phòng';
        }
        if (statusEl) {
            statusEl.innerHTML = '<i class="fas fa-times"></i> Lỗi lưu!';
            statusEl.className = 'save-status error';
        }
    }

    setTimeout(() => { if (statusEl) statusEl.innerHTML = ''; }, 3000);
}

// ===== Custom Cost Calculation =====
async function initCustomCalculation() {
    const btnCalc = document.getElementById('btnCalculate');
    const inputStart = document.getElementById('calcStartTime');
    const inputEnd = document.getElementById('calcEndTime');
    const roomSelect = document.getElementById('calcRoom');

    if (!btnCalc || !inputStart || !inputEnd) return;

    // Set default values (Last 24 hours)
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const formatDateTime = (date) => {
        const pad = (n) => n.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };

    inputStart.value = formatDateTime(yesterday);
    inputEnd.value = formatDateTime(now);

    // Populate room dropdown from API
    if (roomSelect) {
        try {
            const data = await window.api.getData();
            if (data && data.rooms) {
                Object.entries(data.rooms).forEach(([roomId, room]) => {
                    const option = document.createElement('option');
                    option.value = room.name;
                    option.textContent = room.name;
                    roomSelect.appendChild(option);
                });
            }
        } catch (e) {
            console.log('Could not populate room list:', e);
        }
    }

    btnCalc.addEventListener('click', handleCalculateCustomCost);

    // Delete room functionality
    initDeleteRoom();
}

async function initDeleteRoom() {
    const deleteSelect = document.getElementById('deleteRoomSelect');
    const btnDeleteData = document.getElementById('btnDeleteRoomData');
    const btnDeleteAll = document.getElementById('btnDeleteRoomAll');

    if (!deleteSelect || !btnDeleteData || !btnDeleteAll) return;

    // Populate delete room dropdown
    try {
        const data = await window.api.getData();
        if (data && data.rooms) {
            Object.entries(data.rooms).forEach(([roomId, room]) => {
                const option = document.createElement('option');
                // Extract numeric slave_id from roomId (e.g., "room5" -> "5")
                const slaveId = roomId.replace(/\D/g, '');
                option.value = slaveId;
                option.textContent = room.name;
                deleteSelect.appendChild(option);
            });
        }
    } catch (e) {
        console.log('Could not populate delete room list:', e);
    }

    btnDeleteData.addEventListener('click', () => handleDeleteRoom('data'));
    btnDeleteAll.addEventListener('click', () => handleDeleteRoom('all'));
}

async function handleDeleteRoom(type) {
    const deleteSelect = document.getElementById('deleteRoomSelect');
    const slaveId = deleteSelect?.value;

    if (!slaveId) {
        alert('Vui lòng chọn phòng cần xóa!');
        return;
    }

    const roomName = deleteSelect.options[deleteSelect.selectedIndex].text;

    // Show custom modal
    const modal = document.getElementById('deleteModal');
    const modalTitle = document.getElementById('deleteModalTitle');
    const modalMessage = document.getElementById('deleteModalMessage');
    const modalWarning = document.getElementById('deleteModalWarning');
    const btnCancel = document.getElementById('deleteModalCancel');
    const btnConfirm = document.getElementById('deleteModalConfirm');

    if (type === 'all') {
        modalTitle.textContent = `Xóa hoàn toàn ${roomName}`;
        modalMessage.textContent = `Bạn có chắc chắn muốn xóa hoàn toàn tất cả dữ liệu của ${roomName}?`;
        modalWarning.textContent = '⚠️ Hành động này không thể hoàn tác! Tất cả dữ liệu lịch sử và lệnh điều khiển sẽ bị xóa vĩnh viễn.';
    } else {
        modalTitle.textContent = `Xóa lịch sử ${roomName}`;
        modalMessage.textContent = `Bạn có chắc chắn muốn xóa dữ liệu lịch sử công suất của ${roomName}?`;
        modalWarning.textContent = '';
    }

    modal.classList.add('active');

    // Handle modal buttons
    const handleConfirm = async () => {
        modal.classList.remove('active');
        await executeDelete(slaveId, type);
        cleanup();
    };

    const handleCancel = () => {
        modal.classList.remove('active');
        cleanup();
    };

    const cleanup = () => {
        btnConfirm.removeEventListener('click', handleConfirm);
        btnCancel.removeEventListener('click', handleCancel);
    };

    btnConfirm.addEventListener('click', handleConfirm);
    btnCancel.addEventListener('click', handleCancel);
}

async function executeDelete(slaveId, type) {
    const btnDeleteData = document.getElementById('btnDeleteRoomData');
    const btnDeleteAll = document.getElementById('btnDeleteRoomAll');

    try {
        btnDeleteData.disabled = true;
        btnDeleteAll.disabled = true;

        const response = await fetch(`${API_BASE_URL}/room/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slave_id: slaveId, type: type })
        });

        const result = await response.json();

        if (result.success) {
            alert(`✅ ${result.message}`);
            location.reload();
        } else {
            alert(`❌ Lỗi: ${result.message}`);
        }
    } catch (err) {
        console.error('Delete error:', err);
        alert('❌ Lỗi kết nối server!');
    } finally {
        btnDeleteData.disabled = false;
        btnDeleteAll.disabled = false;
    }
}

async function handleCalculateCustomCost() {
    const btn = document.getElementById('btnCalculate');
    const startStr = document.getElementById('calcStartTime').value;
    const endStr = document.getElementById('calcEndTime').value;
    const roomSelect = document.getElementById('calcRoom');
    const selectedRoom = roomSelect?.value || 'all';
    const resultsDiv = document.getElementById('calcResults');
    const resultKwh = document.getElementById('resultKwh');
    const resultCost = document.getElementById('resultCost');

    if (!startStr || !endStr) {
        alert('Vui lòng chọn thời gian bắt đầu và kết thúc!');
        return;
    }

    const startTime = new Date(startStr).getTime();
    const endTime = new Date(endStr).getTime();

    if (startTime >= endTime) {
        alert('Thời gian kết thúc phải sau thời gian bắt đầu!');
        return;
    }

    try {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang tính...';
        btn.disabled = true;

        // Gọi API backend để tính toán (Chính xác hơn client-side)
        const response = await fetch(`${API_BASE_URL}/energy/calculate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                start_time: startStr,
                end_time: endStr,
                room_id: selectedRoom
            })
        });

        const data = await response.json();

        if (data.error) throw new Error(data.error);

        // Hiển thị kết quả từ server trả về
        resultKwh.textContent = data.kwh.toFixed(3) + ' kWh';
        resultCost.textContent = formatCurrency(data.cost) + ' VNĐ';
        resultsDiv.classList.remove('hidden');

    } catch (err) {
        console.error(err);
        alert('Lỗi tính toán: ' + err.message);
    } finally {
        btn.innerHTML = '<i class="fas fa-calculator"></i> Tính toán';
        btn.disabled = false;
    }
}
