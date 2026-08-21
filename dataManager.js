// dataManager.js
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 数据文件路径
const FILES = {
    users: path.join(DATA_DIR, 'users.json'),
    messages: path.join(DATA_DIR, 'messages.json'),
    privateMessages: path.join(DATA_DIR, 'privateMessages.json'),
    friendRequests: path.join(DATA_DIR, 'friendRequests.json'),
    appeals: path.join(DATA_DIR, 'appeals.json'),
    adminLogs: path.join(DATA_DIR, 'adminLogs.json'),
};

// 通用读写函数
function readData(filePath, defaultValue = {}) {
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(content);
        }
        return defaultValue;
    } catch (err) {
        console.error(`读取文件失败 ${filePath}:`, err);
        return defaultValue;
    }
}

function writeData(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        return true;
    } catch (err) {
        console.error(`写入文件失败 ${filePath}:`, err);
        return false;
    }
}

// ============ 用户数据 ============
function loadUsers() {
    const data = readData(FILES.users, {});
    const map = new Map();
    Object.entries(data).forEach(([key, value]) => {
        map.set(key, value);
    });
    return map;
}

function saveUsers(usersMap) {
    const obj = Object.fromEntries(usersMap);
    return writeData(FILES.users, obj);
}

// ============ 消息历史 ============
function loadMessageHistory() {
    return readData(FILES.messages, []);
}

function saveMessageHistory(messages) {
    return writeData(FILES.messages, messages);
}

// ============ 私聊消息 ============
function loadPrivateMessages() {
    const data = readData(FILES.privateMessages, {});
    const map = new Map();
    Object.entries(data).forEach(([key, value]) => {
        map.set(key, value);
    });
    return map;
}

function savePrivateMessages(privateMap) {
    const obj = Object.fromEntries(privateMap);
    return writeData(FILES.privateMessages, obj);
}

// ============ 好友请求 ============
function loadFriendRequests() {
    const data = readData(FILES.friendRequests, {});
    const map = new Map();
    Object.entries(data).forEach(([key, value]) => {
        map.set(key, value);
    });
    return map;
}

function saveFriendRequests(requestsMap) {
    const obj = Object.fromEntries(requestsMap);
    return writeData(FILES.friendRequests, obj);
}

// ============ 申诉 ============
function loadAppeals() {
    return readData(FILES.appeals, []);
}

function saveAppeals(appeals) {
    return writeData(FILES.appeals, appeals);
}

// ============ 操作日志 ============
function loadAdminLogs() {
    return readData(FILES.adminLogs, []);
}

function saveAdminLogs(logs) {
    return writeData(FILES.adminLogs, logs);
}

// ============ 备份功能 ============
function backupAllData() {
    const backupDir = path.join(DATA_DIR, 'backups');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `backup-${timestamp}`);
    
    try {
        // 创建备份目录
        fs.mkdirSync(backupPath, { recursive: true });
        
        // 复制所有数据文件
        const files = ['users.json', 'messages.json', 'privateMessages.json', 'friendRequests.json', 'appeals.json', 'adminLogs.json'];
        files.forEach(file => {
            const src = path.join(DATA_DIR, file);
            const dest = path.join(backupPath, file);
            if (fs.existsSync(src)) {
                fs.copyFileSync(src, dest);
            }
        });
        
        console.log(`✅ 数据备份成功: ${backupPath}`);
        return true;
    } catch (err) {
        console.error('备份失败:', err);
        return false;
    }
}

// ============ 定时自动备份 ============
function startAutoBackup(intervalHours = 24) {
    // 首次启动时备份
    setTimeout(() => backupAllData(), 5000);
    
    // 定时备份
    setInterval(() => {
        backupAllData();
    }, intervalHours * 3600000);
    
    console.log(`⏰ 自动备份已启动，每 ${intervalHours} 小时备份一次`);
}

module.exports = {
    loadUsers,
    saveUsers,
    loadMessageHistory,
    saveMessageHistory,
    loadPrivateMessages,
    savePrivateMessages,
    loadFriendRequests,
    saveFriendRequests,
    loadAppeals,
    saveAppeals,
    loadAdminLogs,
    saveAdminLogs,
    backupAllData,
    startAutoBackup,
    DATA_DIR,
};