// Power Management App - Firebase Realtime Database
let powerChart = null;
let distributionChart = null;

document.addEventListener('DOMContentLoaded', function () {
    // Listen for realtime data from Firebase
    window.powerRef.on('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            updateStats(data);
            renderRooms(data);
            renderTierList(data.settings);
            updateCharts(data);
            updateAlerts(data);
        }
    }, (error) => {
        console.error('Firebase error:', error);
        showOfflineMessage();
    });

    initCharts();
    initNavigation();
    initDeviceControls();
});

// Update dashboard statistics
function updateStats(data) {
    const totalPower = document.getElementById('totalPower');
    const monthlyCost = document.getElementById('monthlyCost');
    const activeRooms = document.getElementById('activeRooms');
    const monthlyEnergy = document.getElementById('monthlyEnergy');
    const todayKwh = document.getElementById('todayKwh');
    const todayCost = document.getElementById('todayCost');
    const monthKwh = document.getElementById('monthKwh');
    const monthCost = document.getElementById('monthCost');

    if (totalPower) totalPower.textContent = formatNumber(data.total?.power || 0);
    if (monthlyCost) monthlyCost.textContent = formatNumber(data.total?.monthly_cost || 0);
    if (monthlyEnergy) monthlyEnergy.textContent = formatNumber(data.energy?.current?.month_kwh || 0);

    let active = 0;
    if (data.rooms) {
        Object.values(data.rooms).forEach(room => {
            if (room.power > 0) active++;
        });
    }
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
        if (warningInput) warningInput.value = data.settings.thresholds.warning;
        if (criticalInput) criticalInput.value = data.settings.thresholds.critical;
    }

    // Update VAT input
    const vatInput = document.getElementById('vatInput');
    if (vatInput && data.settings?.vat !== undefined) vatInput.value = data.settings.vat;
}

// Render rooms grid
function renderRooms(data) {
    const roomsGrid = document.getElementById('roomsGrid');
    if (!roomsGrid || !data.rooms) return;

    roomsGrid.innerHTML = '';

    Object.entries(data.rooms).forEach(([roomId, room]) => {
        const isActive = room.power > 0;
        const roomCard = document.createElement('div');
        roomCard.className = `room-card ${isActive ? 'active' : 'inactive'}`;

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
                                <div class="device-power">${device.power}W / ${device.max_power}W max</div>
                            </div>
                        </div>
                        <div class="device-toggle ${device.state ? 'on' : ''}" 
                             data-room="${roomId}" data-device="${deviceId}"></div>
                    </div>
                `;
            });
        }

        roomCard.innerHTML = `
            <div class="room-header">
                <div class="room-info">
                    <div class="room-icon"><i class="fas fa-door-open"></i></div>
                    <div>
                        <div class="room-name">${room.name}</div>
                        <div class="room-status">
                            <span class="status-dot"></span>
                            <span>${isActive ? 'Đang hoạt động' : 'Không hoạt động'}</span>
                        </div>
                    </div>
                </div>
                <div class="room-power">
                    <div class="power-value">${room.power}</div>
                    <div class="power-unit">Watts</div>
                </div>
            </div>
            <div class="room-devices">${devicesHtml}</div>
        `;

        roomsGrid.appendChild(roomCard);
    });

    // Re-attach device toggle listeners
    initDeviceControls();
}

// Device control - toggle state in Firebase
function initDeviceControls() {
    document.querySelectorAll('.device-toggle').forEach(toggle => {
        toggle.addEventListener('click', function () {
            const roomId = this.dataset.room;
            const deviceId = this.dataset.device;
            const isOn = this.classList.contains('on');

            // Update Firebase
            const controlRef = window.firebaseDatabase.ref(`power_management/control/${roomId}/${deviceId}`);
            controlRef.set(!isOn);

            // Also update device state
            const deviceRef = window.firebaseDatabase.ref(`power_management/rooms/${roomId}/devices/${deviceId}/state`);
            deviceRef.set(!isOn);
        });
    });
}

// Update alerts based on current data
function updateAlerts(data) {
    const alertList = document.getElementById('alertList');
    if (!alertList || !data.settings?.thresholds) return;

    const warningThreshold = data.settings.thresholds.warning;
    const criticalThreshold = data.settings.thresholds.critical;
    const totalPower = data.total?.power || 0;

    let alertsHtml = '';

    // Check total power
    if (totalPower >= criticalThreshold) {
        alertsHtml += createAlert('critical', 'fa-bolt', 'Quá tải nghiêm trọng',
            `Tổng công suất ${totalPower}W vượt ngưỡng nguy hiểm ${criticalThreshold}W`, 'Ngay bây giờ');
    } else if (totalPower >= warningThreshold) {
        alertsHtml += createAlert('warning', 'fa-exclamation-circle', 'Công suất cao',
            `Tổng công suất ${totalPower}W vượt ngưỡng cảnh báo ${warningThreshold}W`, 'Vừa xong');
    }

    // Check each room
    if (data.rooms) {
        Object.values(data.rooms).forEach(room => {
            if (room.power >= warningThreshold) {
                alertsHtml += createAlert('warning', 'fa-exclamation-circle', 'Phòng công suất cao',
                    `${room.name}: ${room.power}W vượt ngưỡng cảnh báo`, '1 phút trước');
            }
        });
    }

    // Count inactive rooms
    let inactiveRooms = [];
    if (data.rooms) {
        Object.values(data.rooms).forEach(room => {
            if (room.power === 0) inactiveRooms.push(room.name);
        });
    }

    if (inactiveRooms.length > 0) {
        alertsHtml += createAlert('info', 'fa-info-circle', 'Phòng không hoạt động',
            `${inactiveRooms.join(', ')} không có thiết bị đang bật`, '5 phút trước');
    }

    if (alertsHtml === '') {
        alertsHtml = createAlert('info', 'fa-check-circle', 'Hệ thống bình thường',
            'Tất cả các chỉ số đều trong ngưỡng cho phép', 'Vừa xong');
    }

    alertList.innerHTML = alertsHtml;
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

// Update tier form with values from Firebase
function renderTierList(settings) {
    if (!settings) return;

    const limits = settings.tier_limits;
    const prices = settings.tier_prices;
    if (!limits || !prices) return;

    // Update limit inputs
    const tierLimit1 = document.getElementById('tierLimit1');
    const tierLimit2 = document.getElementById('tierLimit2');
    const tierLimit3 = document.getElementById('tierLimit3');
    const tierLimit4 = document.getElementById('tierLimit4');
    const tierLimit5 = document.getElementById('tierLimit5');

    if (tierLimit1) tierLimit1.value = limits.tier1;
    if (tierLimit2) tierLimit2.value = limits.tier2;
    if (tierLimit3) tierLimit3.value = limits.tier3;
    if (tierLimit4) tierLimit4.value = limits.tier4;
    if (tierLimit5) tierLimit5.value = limits.tier5;

    // Update price inputs
    const tierPrice1 = document.getElementById('tierPrice1');
    const tierPrice2 = document.getElementById('tierPrice2');
    const tierPrice3 = document.getElementById('tierPrice3');
    const tierPrice4 = document.getElementById('tierPrice4');
    const tierPrice5 = document.getElementById('tierPrice5');
    const tierPrice6 = document.getElementById('tierPrice6');

    if (tierPrice1 && prices[0]) tierPrice1.value = prices[0];
    if (tierPrice2 && prices[1]) tierPrice2.value = prices[1];
    if (tierPrice3 && prices[2]) tierPrice3.value = prices[2];
    if (tierPrice4 && prices[3]) tierPrice4.value = prices[3];
    if (tierPrice5 && prices[4]) tierPrice5.value = prices[4];
    if (tierPrice6 && prices[5]) tierPrice6.value = prices[5];

    // Update display labels
    updateTierDisplayLabels();

    // Initialize save button listener (only once)
    initTierSaveButton();
}

// Update the display labels for tier ranges
function updateTierDisplayLabels() {
    const limit1 = parseInt(document.getElementById('tierLimit1')?.value) || 50;
    const limit2 = parseInt(document.getElementById('tierLimit2')?.value) || 100;
    const limit3 = parseInt(document.getElementById('tierLimit3')?.value) || 200;
    const limit4 = parseInt(document.getElementById('tierLimit4')?.value) || 300;
    const limit5 = parseInt(document.getElementById('tierLimit5')?.value) || 400;

    const display1 = document.getElementById('tierLimit1Display');
    const display2 = document.getElementById('tierLimit2Display');
    const display3 = document.getElementById('tierLimit3Display');
    const display4 = document.getElementById('tierLimit4Display');
    const display5 = document.getElementById('tierLimit5Display');

    if (display1) display1.textContent = limit1 + 1;
    if (display2) display2.textContent = limit2 + 1;
    if (display3) display3.textContent = limit3 + 1;
    if (display4) display4.textContent = limit4 + 1;
    if (display5) display5.textContent = limit5;
}

// Initialize save button
let tierSaveInitialized = false;
function initTierSaveButton() {
    if (tierSaveInitialized) return;
    tierSaveInitialized = true;

    const saveBtn = document.getElementById('saveTierBtn');
    if (!saveBtn) return;

    // Update labels when inputs change
    document.querySelectorAll('.tier-limit-input').forEach(input => {
        input.addEventListener('input', updateTierDisplayLabels);
    });

    // Save button click - show confirmation modal
    saveBtn.addEventListener('click', () => showGenericConfirmModal('tier'));

    // Modal buttons - set up once
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

    // Close modal when clicking overlay
    if (modal && !modal.hasAttribute('data-initialized')) {
        modal.setAttribute('data-initialized', 'true');
        modal.addEventListener('click', (e) => {
            if (e.target === modal) hideConfirmModal();
        });
    }
}

// Hide confirmation modal
function hideConfirmModal() {
    const modal = document.getElementById('confirmModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

// Execute save tier settings to Firebase (called after confirmation)
function executeSaveTierSettings() {
    const saveBtn = document.getElementById('saveTierBtn');

    // Get values from inputs
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

    // Show saving state
    saveBtn.classList.add('saving');
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang lưu...';

    // Save to Firebase
    const settingsRef = window.firebaseDatabase.ref('power_management/settings');

    Promise.all([
        settingsRef.child('tier_limits').set(tierLimits),
        settingsRef.child('tier_prices').set(tierPrices)
    ]).then(() => {
        saveBtn.classList.remove('saving');
        saveBtn.innerHTML = '<i class="fas fa-check"></i> Đã lưu!';
        showSaveStatus('success', '✓ Đã lưu thay đổi thành công!');

        setTimeout(() => {
            saveBtn.innerHTML = '<i class="fas fa-save"></i> Lưu thay đổi';
        }, 2000);
    }).catch((error) => {
        console.error('Error saving tier settings:', error);
        saveBtn.classList.remove('saving');
        saveBtn.innerHTML = '<i class="fas fa-save"></i> Lưu thay đổi';
        showSaveStatus('error', '✗ Lỗi khi lưu. Vui lòng thử lại!');
    });
}

function showSaveStatus(type, message) {
    const saveStatus = document.getElementById('saveStatus');
    if (!saveStatus) return;

    saveStatus.className = 'save-status ' + type;
    saveStatus.textContent = message;

    // Auto hide after 3 seconds
    setTimeout(() => {
        saveStatus.className = 'save-status';
        saveStatus.textContent = '';
    }, 3000);
}

// Initialize Charts
function initCharts() {
    initPowerChart();
    initDistributionChart();
}

function updateCharts(data) {
    if (powerChart && data.total) {
        const newData = generateMockPowerData(data.total.power);
        powerChart.data.datasets[0].data = newData;
        powerChart.update('none');
    }

    if (distributionChart && data.rooms) {
        const roomPowers = Object.values(data.rooms).map(r => r.power);
        distributionChart.data.datasets[0].data = roomPowers;
        distributionChart.update('none');
    }
}

function initPowerChart() {
    const ctx = document.getElementById('powerChart');
    if (!ctx) return;

    const hours = Array.from({ length: 24 }, (_, i) => `${i}:00`);
    const mockData = generateMockPowerData(1724);

    powerChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: hours,
            datasets: [{
                label: 'Công suất (W)',
                data: mockData,
                borderColor: 'rgb(99, 137, 255)',
                backgroundColor: 'rgba(99, 137, 255, 0.1)',
                fill: true,
                tension: 0.4,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.5)' } },
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.5)' } }
            },
            interaction: { intersect: false, mode: 'index' }
        }
    });
}

function initDistributionChart() {
    const ctx = document.getElementById('distributionChart');
    if (!ctx) return;

    const roomNames = ['Phòng 1', 'Phòng 2', 'Phòng 3', 'Phòng 4'];
    const roomPowers = [862, 862, 0, 0];
    const colors = ['#6389ff', '#2ed589', '#fbbf24', '#ef5350'];

    distributionChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: roomNames,
            datasets: [{
                data: roomPowers,
                backgroundColor: colors,
                borderWidth: 0,
                hoverOffset: 10
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: 'rgba(255,255,255,0.7)', padding: 15, usePointStyle: true }
                }
            }
        }
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

    document.querySelectorAll('.btn-icon[data-period]').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.btn-icon[data-period]').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        });
    });

    // Refresh button
    document.querySelector('.btn-outline')?.addEventListener('click', function () {
        this.querySelector('i').classList.add('fa-spin');
        setTimeout(() => this.querySelector('i').classList.remove('fa-spin'), 1000);
    });
}

function showOfflineMessage() {
    console.log('Unable to connect to Firebase. Please check your internet connection.');
}

// Utilities
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function getDeviceIcon(name) {
    const icons = { 'Đèn': 'fa-lightbulb', 'Quạt': 'fa-fan', 'Điều hòa': 'fa-snowflake' };
    return icons[name] || 'fa-plug';
}

function generateMockPowerData(currentPower) {
    const data = [];
    for (let i = 0; i < 24; i++) {
        const factor = i < 6 ? 0.3 : i < 9 ? 0.7 : i < 18 ? 0.9 : i < 22 ? 1 : 0.5;
        const variation = (Math.random() - 0.5) * 400;
        data.push(Math.max(0, Math.round(currentPower * factor + variation)));
    }
    return data;
}

// ===== Threshold Save Functions =====
let thresholdSaveInitialized = false;
let pendingSaveType = null; // 'threshold', 'vat', or 'tier'

function initThresholdSave() {
    if (thresholdSaveInitialized) return;
    thresholdSaveInitialized = true;

    const saveBtn = document.getElementById('saveThresholdBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => showGenericConfirmModal('threshold'));
    }
}

function executeThresholdSave() {
    const saveBtn = document.getElementById('saveThresholdBtn');
    const warningValue = parseInt(document.getElementById('warningThresholdInput')?.value) || 500;
    const criticalValue = parseInt(document.getElementById('criticalThresholdInput')?.value) || 1000;

    // Validate: warning must be less than critical
    if (warningValue >= criticalValue) {
        showStatusMessage('thresholdSaveStatus', 'error', 'Lỗi: Ngưỡng cảnh báo phải nhỏ hơn ngưỡng nguy hiểm!');
        return;
    }

    // Show saving state
    saveBtn.classList.add('saving');
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang lưu...';

    const thresholdsRef = window.firebaseDatabase.ref('power_management/settings/thresholds');
    thresholdsRef.set({
        warning: warningValue,
        critical: criticalValue
    }).then(() => {
        saveBtn.classList.remove('saving');
        saveBtn.innerHTML = '<i class="fas fa-check"></i> Đã lưu!';
        showStatusMessage('thresholdSaveStatus', 'success', '✓ Đã lưu ngưỡng cảnh báo!');
        setTimeout(() => {
            saveBtn.innerHTML = '<i class="fas fa-save"></i> Lưu ngưỡng';
        }, 2000);
    }).catch((error) => {
        console.error('Error saving thresholds:', error);
        saveBtn.classList.remove('saving');
        saveBtn.innerHTML = '<i class="fas fa-save"></i> Lưu ngưỡng';
        showStatusMessage('thresholdSaveStatus', 'error', '✗ Lỗi khi lưu!');
    });
}

// ===== VAT Save Functions =====
let vatSaveInitialized = false;

function initVatSave() {
    if (vatSaveInitialized) return;
    vatSaveInitialized = true;

    const saveBtn = document.getElementById('saveVatBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => showGenericConfirmModal('vat'));
    }
}

function executeVatSave() {
    const saveBtn = document.getElementById('saveVatBtn');
    const vatValue = parseInt(document.getElementById('vatInput')?.value) || 8;

    // Validate: VAT between 0 and 100
    if (vatValue < 0 || vatValue > 100) {
        showStatusMessage('vatSaveStatus', 'error', 'Lỗi: Thuế VAT phải từ 0 đến 100!');
        return;
    }

    // Show saving state
    saveBtn.classList.add('saving');
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang lưu...';

    const vatRef = window.firebaseDatabase.ref('power_management/settings/vat');
    vatRef.set(vatValue).then(() => {
        saveBtn.classList.remove('saving');
        saveBtn.innerHTML = '<i class="fas fa-check"></i> Đã lưu!';
        showStatusMessage('vatSaveStatus', 'success', '✓ Đã lưu thuế VAT!');
        setTimeout(() => {
            saveBtn.innerHTML = '<i class="fas fa-save"></i> Lưu thuế VAT';
        }, 2000);
    }).catch((error) => {
        console.error('Error saving VAT:', error);
        saveBtn.classList.remove('saving');
        saveBtn.innerHTML = '<i class="fas fa-save"></i> Lưu thuế VAT';
        showStatusMessage('vatSaveStatus', 'error', '✗ Lỗi khi lưu!');
    });
}

// ===== Generic Confirm Modal =====
function showGenericConfirmModal(type) {
    pendingSaveType = type;

    const modal = document.getElementById('confirmModal');
    const title = document.querySelector('.modal-title');
    const message = document.querySelector('.modal-message');

    if (type === 'threshold') {
        // Validate first
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
        // Validate tier limits first
        const tierLimits = {
            tier1: parseInt(document.getElementById('tierLimit1')?.value) || 50,
            tier2: parseInt(document.getElementById('tierLimit2')?.value) || 100,
            tier3: parseInt(document.getElementById('tierLimit3')?.value) || 200,
            tier4: parseInt(document.getElementById('tierLimit4')?.value) || 300,
            tier5: parseInt(document.getElementById('tierLimit5')?.value) || 400
        };
        if (tierLimits.tier1 >= tierLimits.tier2 ||
            tierLimits.tier2 >= tierLimits.tier3 ||
            tierLimits.tier3 >= tierLimits.tier4 ||
            tierLimits.tier4 >= tierLimits.tier5) {
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

    if (pendingSaveType === 'threshold') {
        executeThresholdSave();
    } else if (pendingSaveType === 'vat') {
        executeVatSave();
    } else if (pendingSaveType === 'tier') {
        executeSaveTierSettings();
    }

    pendingSaveType = null;
}

function showStatusMessage(elementId, type, message) {
    const element = document.getElementById(elementId);
    if (!element) return;

    element.className = 'save-status ' + type;
    element.textContent = message;

    setTimeout(() => {
        element.className = 'save-status';
        element.textContent = '';
    }, 3000);
}

// Initialize all save buttons when data loads
document.addEventListener('DOMContentLoaded', function () {
    // Wait a bit for Firebase to load, then init save buttons
    setTimeout(() => {
        initThresholdSave();
        initVatSave();
    }, 1000);
});
