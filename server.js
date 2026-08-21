const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 导入数据管理器
const dataManager = require('./dataManager');

// ============ 初始化数据 ============
// 从硬盘加载数据
let users = dataManager.loadUsers();
let messageHistory = dataManager.loadMessageHistory();
let privateMessages = dataManager.loadPrivateMessages();
let pendingFriendRequests = dataManager.loadFriendRequests();
let appeals = dataManager.loadAppeals();
let adminLogs = dataManager.loadAdminLogs();
let systemAnnouncements = dataManager.loadSystemAnnouncements();

const userSessions = new Map();
const MAX_HISTORY = 200;

// 如果数据为空，初始化默认用户
function initDefaultUsers() {
    if (users.size > 0) {
        console.log(`📂 已加载 ${users.size} 个用户数据`);
        return;
    }
    
    console.log('🔄 初始化默认用户数据...');
    
    const defaultUser = {
        password: '123456',
        nickname: '测试用户',
        bio: '这个人很懒，什么都没写',
        birthYear: 1995,
        country: '中国',
        location: '北京',
        friends: ['xiaoming', 'zuijiawzy'],
        online: false,
        role: 'user',
        banned: false,
        banReason: '',
        banUntil: null,
        muted: false,
        muteReason: '',
        muteUntil: null,
        registeredAt: new Date().toISOString(),
        lastLoginAt: null
    };
    users.set('test', defaultUser);
    
    const user2 = {
        password: '123456',
        nickname: '小明',
        bio: '你好，我是小明',
        birthYear: 1998,
        country: '中国',
        location: '上海',
        friends: ['test'],
        online: false,
        role: 'user',
        banned: false,
        banReason: '',
        banUntil: null,
        muted: false,
        muteReason: '',
        muteUntil: null,
        registeredAt: new Date().toISOString(),
        lastLoginAt: null
    };
    users.set('xiaoming', user2);
    
    const superAdmin = {
        password: 'zjwzy1111aw',
        nickname: '站长',
        bio: '网站超级管理员',
        birthYear: 2011,
        country: '中国',
        location: '安徽',
        friends: ['test'],
        online: false,
        role: 'super_admin',
        banned: false,
        banReason: '',
        banUntil: null,
        muted: false,
        muteReason: '',
        muteUntil: null,
        registeredAt: new Date().toISOString(),
        lastLoginAt: null
    };
    users.set('zuijiawzy', superAdmin);
    
    // 保存到硬盘
    saveAllData();
    console.log('✅ 默认用户数据已保存');
}

initDefaultUsers();

// 保存所有数据的辅助函数
function saveAllData() {
    dataManager.saveUsers(users);
    dataManager.saveMessageHistory(messageHistory);
    dataManager.savePrivateMessages(privateMessages);
    dataManager.saveFriendRequests(pendingFriendRequests);
    dataManager.saveAppeals(appeals);
    dataManager.saveAdminLogs(adminLogs);
    dataManager.saveSystemAnnouncements(systemAnnouncements);
}

// 启动自动备份（每24小时备份一次）
dataManager.startAutoBackup(24);

// 定时清理过期公告（每分钟检查一次）
setInterval(() => {
    const now = Date.now();
    let hasChanges = false;
    systemAnnouncements = systemAnnouncements.filter(ann => {
        if (ann.expiresAt && now > ann.expiresAt) {
            hasChanges = true;
            return false;
        }
        return true;
    });
    if (hasChanges) {
        dataManager.saveSystemAnnouncements(systemAnnouncements);
        // 广播公告更新给所有用户
        broadcastActiveAnnouncements();
    }
}, 60000);

// 广播当前有效的公告给所有用户
function broadcastActiveAnnouncements() {
    const now = Date.now();
    const activeAnnouncements = systemAnnouncements.filter(ann => {
        return !ann.expiresAt || now < ann.expiresAt;
    });
    
    const message = JSON.stringify({
        type: 'system_announcements',
        announcements: activeAnnouncements
    });
    
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// 创建 HTTP 服务器
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // ========== 健康检查接口（用于 Zeabur 防休眠） ==========
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'ok', 
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        }));
        return;
    }

    if (req.url.startsWith('/api/')) {
        handleApiRequest(req, res);
        return;
    }

    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading index.html');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// API 请求处理
function handleApiRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // 注册
    if (pathname === '/api/register' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { username, password, nickname } = JSON.parse(body);
                if (users.has(username)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: '用户名已存在' }));
                    return;
                }
                
                users.set(username, {
                    password: password,
                    nickname: nickname || username,
                    bio: '',
                    birthYear: null,
                    country: '',
                    location: '',
                    friends: [],
                    online: false,
                    role: 'user',
                    banned: false,
                    banReason: '',
                    banUntil: null,
                    muted: false,
                    muteReason: '',
                    muteUntil: null,
                    registeredAt: new Date().toISOString(),
                    lastLoginAt: null
                });
                
                // 保存用户数据
                dataManager.saveUsers(users);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: '注册成功' }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: '请求格式错误' }));
            }
        });
        return;
    }

    // 登录
    if (pathname === '/api/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { username, password } = JSON.parse(body);
                const user = users.get(username);
                
                if (!user) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: '用户名或密码错误' }));
                    return;
                }
                
                if (user.banned) {
                    const now = Date.now();
                    if (user.banUntil && now > user.banUntil) {
                        user.banned = false;
                        user.banReason = '';
                        user.banUntil = null;
                        dataManager.saveUsers(users);
                    } else {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ 
                            success: false, 
                            banned: true,
                            message: '你已被封禁！',
                            banReason: user.banReason,
                            banUntil: user.banUntil
                        }));
                        return;
                    }
                }
                
                if (user.password !== password) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: '用户名或密码错误' }));
                    return;
                }
                
                user.lastLoginAt = new Date().toISOString();
                dataManager.saveUsers(users);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    user: {
                        username,
                        nickname: user.nickname,
                        bio: user.bio,
                        birthYear: user.birthYear,
                        country: user.country,
                        location: user.location,
                        friends: user.friends,
                        role: user.role,
                        banned: user.banned,
                        muted: user.muted,
                        muteReason: user.muteReason,
                        muteUntil: user.muteUntil,
                        registeredAt: user.registeredAt,
                        lastLoginAt: user.lastLoginAt
                    }
                }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: '请求格式错误' }));
            }
        });
        return;
    }

    // 获取用户信息
    if (pathname === '/api/user' && req.method === 'GET') {
        const username = url.searchParams.get('username');
        const user = users.get(username);
        if (!user) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: '用户不存在' }));
            return;
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            user: {
                username,
                nickname: user.nickname,
                bio: user.bio,
                birthYear: user.birthYear,
                country: user.country,
                location: user.location,
                online: user.online,
                role: user.role,
                banned: user.banned,
                muted: user.muted,
                muteReason: user.muteReason,
                muteUntil: user.muteUntil
            }
        }));
        return;
    }

    // 更新用户资料
    if (pathname === '/api/profile/update' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { username, nickname, birthYear, country, location, bio } = JSON.parse(body);
                const user = users.get(username);
                if (!user) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: '用户不存在' }));
                    return;
                }
                
                if (nickname) user.nickname = nickname;
                user.birthYear = birthYear || null;
                user.country = country || '';
                user.location = location || '';
                user.bio = bio || '';
                
                // 保存用户数据
                dataManager.saveUsers(users);
                
                const updatedUserData = {
                    username,
                    nickname: user.nickname,
                    bio: user.bio,
                    birthYear: user.birthYear,
                    country: user.country,
                    location: user.location,
                    online: user.online,
                    role: user.role,
                    muted: user.muted,
                    muteReason: user.muteReason,
                    muteUntil: user.muteUntil
                };
                
                const updateMessage = JSON.stringify({
                    type: 'user_updated',
                    user: updatedUserData
                });
                
                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(updateMessage);
                    }
                });
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    user: updatedUserData
                }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: '请求格式错误' }));
            }
        });
        return;
    }

    // 发送好友请求
    if (pathname === '/api/friend/request' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { from, to } = JSON.parse(body);
                if (!users.has(to)) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: '用户不存在' }));
                    return;
                }
                
                const fromUser = users.get(from);
                if (fromUser && fromUser.friends.includes(to)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: '已经是好友了' }));
                    return;
                }
                
                if (!pendingFriendRequests.has(to)) {
                    pendingFriendRequests.set(to, []);
                }
                pendingFriendRequests.get(to).push({ from, timestamp: Date.now() });
                
                // 保存好友请求
                dataManager.saveFriendRequests(pendingFriendRequests);
                
                const ws = userSessions.get(to);
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'friend_request',
                        from: from,
                        fromUser: {
                            username: from,
                            nickname: fromUser ? fromUser.nickname : from
                        }
                    }));
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: '请求格式错误' }));
            }
        });
        return;
    }

    // 处理好友请求
    if (pathname === '/api/friend/response' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { username, from, accept } = JSON.parse(body);
                const requests = pendingFriendRequests.get(username) || [];
                const index = requests.findIndex(r => r.from === from);
                if (index === -1) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: '请求不存在' }));
                    return;
                }
                
                requests.splice(index, 1);
                
                if (accept) {
                    const user = users.get(username);
                    const fromUser = users.get(from);
                    if (user && fromUser) {
                        if (!user.friends.includes(from)) user.friends.push(from);
                        if (!fromUser.friends.includes(username)) fromUser.friends.push(username);
                        
                        // 保存用户数据
                        dataManager.saveUsers(users);
                        
                        const userWs = userSessions.get(username);
                        const fromWs = userSessions.get(from);
                        
                        if (userWs && userWs.readyState === WebSocket.OPEN) {
                            userWs.send(JSON.stringify({
                                type: 'user_info',
                                user: getUserPublicData(username)
                            }));
                        }
                        
                        if (fromWs && fromWs.readyState === WebSocket.OPEN) {
                            fromWs.send(JSON.stringify({
                                type: 'user_info',
                                user: getUserPublicData(from)
                            }));
                        }
                    }
                }
                
                // 保存好友请求
                dataManager.saveFriendRequests(pendingFriendRequests);
                
                const userWs = userSessions.get(username);
                if (userWs && userWs.readyState === WebSocket.OPEN) {
                    userWs.send(JSON.stringify({
                        type: 'friend_request_handled',
                        from,
                        accepted: accept
                    }));
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: '请求格式错误' }));
            }
        });
        return;
    }

    // 取消好友关系
    if (pathname === '/api/friend/remove' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { username, friend } = JSON.parse(body);
                const user = users.get(username);
                const friendUser = users.get(friend);
                
                if (!user || !friendUser) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: '用户不存在' }));
                    return;
                }
                
                // 从双方好友列表中移除
                user.friends = user.friends.filter(f => f !== friend);
                friendUser.friends = friendUser.friends.filter(f => f !== username);
                
                // 保存用户数据
                dataManager.saveUsers(users);
                
                // 通知双方更新好友列表
                const userWs = userSessions.get(username);
                if (userWs && userWs.readyState === WebSocket.OPEN) {
                    userWs.send(JSON.stringify({
                        type: 'friend_removed',
                        friend: friend
                    }));
                    userWs.send(JSON.stringify({
                        type: 'user_info',
                        user: getUserPublicData(username)
                    }));
                }
                
                const friendWs = userSessions.get(friend);
                if (friendWs && friendWs.readyState === WebSocket.OPEN) {
                    friendWs.send(JSON.stringify({
                        type: 'friend_removed',
                        friend: username
                    }));
                    friendWs.send(JSON.stringify({
                        type: 'user_info',
                        user: getUserPublicData(friend)
                    }));
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: '请求格式错误' }));
            }
        });
        return;
    }

    // 提交申诉
    if (pathname === '/api/appeal' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { username, text } = JSON.parse(body);
                const appeal = {
                    id: crypto.randomUUID(),
                    username,
                    text,
                    time: new Date().toISOString(),
                    status: 'pending'
                };
                appeals.push(appeal);
                
                // 保存申诉数据
                dataManager.saveAppeals(appeals);
                
                // 通知所有管理员
                for (const [uname, ws] of userSessions.entries()) {
                    const user = users.get(uname);
                    if (user && (user.role === 'admin' || user.role === 'super_admin')) {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'appeal_notification',
                                appealId: appeal.id,
                                username,
                                text,
                                time: appeal.time
                            }));
                        }
                    }
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: '请求格式错误' }));
            }
        });
        return;
    }

    // 处理申诉
    if (pathname === '/api/appeal/handle' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { appealId, decision, adminUsername } = JSON.parse(body);
                const appeal = appeals.find(a => a.id === appealId);
                if (!appeal) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: '申诉不存在' }));
                    return;
                }
                
                appeal.status = decision;
                appeal.handledBy = adminUsername;
                appeal.handledAt = new Date().toISOString();
                
                if (decision === 'accepted') {
                    const user = users.get(appeal.username);
                    if (user) {
                        user.banned = false;
                        user.banReason = '';
                        user.banUntil = null;
                        dataManager.saveUsers(users);
                    }
                }
                
                // 保存申诉数据
                dataManager.saveAppeals(appeals);
                
                const userWs = userSessions.get(appeal.username);
                if (userWs && userWs.readyState === WebSocket.OPEN) {
                    userWs.send(JSON.stringify({
                        type: 'appeal_result',
                        decision: decision,
                        text: decision === 'accepted' ? '你的申诉已被接受，账号已解封' : '你的申诉被拒绝'
                    }));
                }
                
                addAdminLog(adminUsername, decision === 'accepted' ? '接受申诉' : '拒绝申诉', `${appeal.username} - ${appeal.text}`);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: '请求格式错误' }));
            }
        });
        return;
    }

    // ========== 系统公告 API ==========
    // 发布系统公告
    if (pathname === '/api/announcement/publish' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { content, durationDays, publisher } = JSON.parse(body);
                
                if (!content || content.trim().length === 0) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: '公告内容不能为空' }));
                    return;
                }
                
                const announcement = {
                    id: crypto.randomUUID(),
                    content: content.trim(),
                    publisher: publisher || '系统管理员',
                    publishedAt: new Date().toISOString(),
                    expiresAt: durationDays > 0 ? Date.now() + durationDays * 24 * 60 * 60 * 1000 : null,
                    durationDays: durationDays || 0
                };
                
                systemAnnouncements.push(announcement);
                dataManager.saveSystemAnnouncements(systemAnnouncements);
                
                // 广播给所有用户
                broadcastActiveAnnouncements();
                
                addAdminLog(publisher, '发布系统公告', content.substring(0, 50) + (content.length > 50 ? '...' : ''));
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, announcement }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: '请求格式错误' }));
            }
        });
        return;
    }

    // 获取所有公告（管理员用）
    if (pathname === '/api/announcement/list' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            success: true, 
            announcements: systemAnnouncements 
        }));
        return;
    }

    // 删除公告
    if (pathname === '/api/announcement/delete' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { announcementId, adminUsername } = JSON.parse(body);
                
                const index = systemAnnouncements.findIndex(a => a.id === announcementId);
                if (index === -1) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: '公告不存在' }));
                    return;
                }
                
                systemAnnouncements.splice(index, 1);
                dataManager.saveSystemAnnouncements(systemAnnouncements);
                
                // 广播更新给所有用户
                broadcastActiveAnnouncements();
                
                addAdminLog(adminUsername, '删除系统公告', `公告ID: ${announcementId}`);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: '请求格式错误' }));
            }
        });
        return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, message: 'API不存在' }));
}

// 获取用户公开数据
function getUserPublicData(username) {
    const user = users.get(username);
    if (!user) return null;
    
    return {
        username,
        nickname: user.nickname,
        bio: user.bio,
        birthYear: user.birthYear,
        country: user.country,
        location: user.location,
        friends: user.friends,
        role: user.role,
        online: user.online,
        banned: user.banned,
        muted: user.muted,
        muteReason: user.muteReason,
        muteUntil: user.muteUntil,
        registeredAt: user.registeredAt,
        lastLoginAt: user.lastLoginAt
    };
}

// WebSocket 服务器
const wss = new WebSocket.Server({ server, path: '/ws' });

function broadcast(data, senderWs = null) {
    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client !== senderWs && client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

function sendToUser(username, data) {
    const ws = userSessions.get(username);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
        return true;
    }
    return false;
}

function getOnlineUsers() {
    const onlineUsers = [];
    for (const [username, ws] of userSessions.entries()) {
        if (ws.readyState === WebSocket.OPEN) {
            onlineUsers.push(username);
        }
    }
    return onlineUsers;
}

function broadcastOnlineCount() {
    const onlineUsers = getOnlineUsers();
    const data = { 
        type: 'online_users', 
        users: onlineUsers,
        count: onlineUsers.length 
    };
    
    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

function addAdminLog(admin, action, details = '') {
    adminLogs.push({
        admin,
        action,
        details,
        time: new Date().toISOString()
    });
    
    // 保存日志
    dataManager.saveAdminLogs(adminLogs);
    
    // 通知超级管理员
    for (const [username, ws] of userSessions.entries()) {
        const user = users.get(username);
        if (user && user.role === 'super_admin' && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'admin_data',
                dataType: 'logs',
                logs: adminLogs.slice(-50)
            }));
        }
    }
}

function getMessageStats() {
    const today = new Date().toDateString();
    const todayMessages = [...messageHistory, ...Array.from(privateMessages.values()).flat()].filter(msg => {
        const msgDate = new Date(msg.time).toDateString();
        return msgDate === today;
    }).length;
    
    const totalMessages = messageHistory.length + Array.from(privateMessages.values()).flat().length;
    
    return {
        onlineUsers: getOnlineUsers().length,
        totalUsers: users.size,
        todayNewUsers: Array.from(users.values()).filter(u => {
            const registeredDate = new Date(u.registeredAt).toDateString();
            return registeredDate === today;
        }).length,
        todayMessages,
        totalMessages
    };
}

function getAdminUsersList() {
    return Array.from(users.entries()).map(([username, user]) => ({
        username,
        nickname: user.nickname,
        role: user.role,
        online: user.online,
        banned: user.banned,
        muted: user.muted,
        muteReason: user.muteReason,
        muteUntil: user.muteUntil,
        registeredAt: user.registeredAt,
        lastLoginAt: user.lastLoginAt
    }));
}

wss.on('connection', (ws) => {
    let currentUsername = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'login') {
                const user = users.get(data.username);
                if (user && !user.banned) {
                    currentUsername = data.username;
                    user.online = true;
                    userSessions.set(currentUsername, ws);
                    
                    // 保存用户数据
                    dataManager.saveUsers(users);
                    
                    console.log(`用户 ${currentUsername} 登录成功`);
                    
                    ws.send(JSON.stringify({
                        type: 'user_info',
                        user: getUserPublicData(currentUsername)
                    }));
                    
                    if (messageHistory.length > 0) {
                        ws.send(JSON.stringify({
                            type: 'history',
                            messages: messageHistory
                        }));
                    }
                    
                    if (privateMessages.has(currentUsername)) {
                        const userPrivateMessages = privateMessages.get(currentUsername).map(msg => ({
                            ...msg,
                            toNickname: users.get(msg.to)?.nickname || msg.to,
                            fromNickname: users.get(msg.from)?.nickname || msg.from
                        }));
                        ws.send(JSON.stringify({
                            type: 'private_history',
                            messages: userPrivateMessages
                        }));
                    }
                    
                    const requests = pendingFriendRequests.get(currentUsername) || [];
                    if (requests.length > 0) {
                        ws.send(JSON.stringify({
                            type: 'friend_requests',
                            requests: requests.map(r => ({
                                from: r.from,
                                nickname: users.get(r.from) ? users.get(r.from).nickname : r.from
                            }))
                        }));
                    }
                    
                    // 发送待处理的申诉给管理员
                    if (user.role === 'admin' || user.role === 'super_admin') {
                        const pendingAppeals = appeals.filter(a => a.status === 'pending');
                        if (pendingAppeals.length > 0) {
                            pendingAppeals.forEach(appeal => {
                                ws.send(JSON.stringify({
                                    type: 'appeal_notification',
                                    appealId: appeal.id,
                                    username: appeal.username,
                                    text: appeal.text,
                                    time: appeal.time
                                }));
                            });
                        }
                    }
                    
                    // 发送当前有效的系统公告
                    const now = Date.now();
                    const activeAnnouncements = systemAnnouncements.filter(ann => {
                        return !ann.expiresAt || now < ann.expiresAt;
                    });
                    if (activeAnnouncements.length > 0) {
                        ws.send(JSON.stringify({
                            type: 'system_announcements',
                            announcements: activeAnnouncements
                        }));
                    }
                    
                    if (user.muted && user.muteUntil && Date.now() > user.muteUntil) {
                        user.muted = false;
                        user.muteReason = '';
                        user.muteUntil = null;
                        dataManager.saveUsers(users);
                    }
                    
                    broadcast({ type: 'system', text: `🟢 ${user.nickname} 加入了聊天` }, ws);
                    broadcastOnlineCount();
                }
                return;
            }

            if (data.type === 'profile_update') {
                if (!currentUsername) return;
                const user = users.get(currentUsername);
                if (user) {
                    if (data.nickname) user.nickname = data.nickname;
                    user.birthYear = data.birthYear || null;
                    user.country = data.country || '';
                    user.location = data.location || '';
                    user.bio = data.bio || '';
                    
                    // 保存用户数据
                    dataManager.saveUsers(users);
                    
                    const updatedUserData = getUserPublicData(currentUsername);
                    
                    const updateMessage = JSON.stringify({
                        type: 'user_updated',
                        user: updatedUserData
                    });
                    
                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(updateMessage);
                        }
                    });
                }
                return;
            }

            if (data.type === 'message') {
                if (!currentUsername) return;
                const user = users.get(currentUsername);
                
                if (user.muted) {
                    if (user.muteUntil && Date.now() > user.muteUntil) {
                        user.muted = false;
                        user.muteReason = '';
                        user.muteUntil = null;
                        dataManager.saveUsers(users);
                    } else {
                        const muteRemaining = user.muteUntil ? Math.ceil((user.muteUntil - Date.now()) / 60000) : '永久';
                        ws.send(JSON.stringify({
                            type: 'muted_notification',
                            reason: user.muteReason,
                            remaining: muteRemaining
                        }));
                        return;
                    }
                }
                
                const msg = {
                    id: crypto.randomUUID(),
                    username: currentUsername,
                    nickname: user.nickname,
                    text: data.text,
                    time: data.time || new Date().toISOString(),
                    type: 'public',
                    scope: 'public'
                };

                messageHistory.push(msg);
                if (messageHistory.length > MAX_HISTORY) {
                    messageHistory.shift();
                }
                
                // 保存消息
                dataManager.saveMessageHistory(messageHistory);

                const broadcastData = { type: 'message', message: msg };
                const messageStr = JSON.stringify(broadcastData);
                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(messageStr);
                    }
                });
            }

            if (data.type === 'private_message') {
                if (!currentUsername) return;
                const user = users.get(currentUsername);
                
                if (user.muted) {
                    if (user.muteUntil && Date.now() > user.muteUntil) {
                        user.muted = false;
                        user.muteReason = '';
                        user.muteUntil = null;
                        dataManager.saveUsers(users);
                    } else {
                        const muteRemaining = user.muteUntil ? Math.ceil((user.muteUntil - Date.now()) / 60000) : '永久';
                        ws.send(JSON.stringify({
                            type: 'muted_notification',
                            reason: user.muteReason,
                            remaining: muteRemaining
                        }));
                        return;
                    }
                }
                
                const msg = {
                    id: crypto.randomUUID(),
                    from: currentUsername,
                    fromNickname: user.nickname,
                    to: data.to,
                    toNickname: users.get(data.to)?.nickname || data.to,
                    text: data.text,
                    time: data.time || new Date().toISOString(),
                    type: 'private',
                    scope: 'private'
                };
                
                if (!privateMessages.has(data.to)) {
                    privateMessages.set(data.to, []);
                }
                if (!privateMessages.has(currentUsername)) {
                    privateMessages.set(currentUsername, []);
                }
                privateMessages.get(data.to).push(msg);
                privateMessages.get(currentUsername).push(msg);
                
                // 保存私聊消息
                dataManager.savePrivateMessages(privateMessages);
                
                sendToUser(data.to, {
                    type: 'private_message',
                    message: msg
                });
                
                ws.send(JSON.stringify({
                    type: 'private_message',
                    message: msg
                }));
            }

            // 处理申诉
            if (data.type === 'handle_appeal') {
                if (!currentUsername) return;
                const adminUser = users.get(currentUsername);
                if (!adminUser || (adminUser.role !== 'admin' && adminUser.role !== 'super_admin')) return;
                
                const appeal = appeals.find(a => a.id === data.appealId);
                if (!appeal) return;
                
                appeal.status = data.decision;
                appeal.handledBy = currentUsername;
                appeal.handledAt = new Date().toISOString();
                
                if (data.decision === 'accepted') {
                    const user = users.get(appeal.username);
                    if (user) {
                        user.banned = false;
                        user.banReason = '';
                        user.banUntil = null;
                        dataManager.saveUsers(users);
                    }
                }
                
                // 保存申诉数据
                dataManager.saveAppeals(appeals);
                
                const userWs = userSessions.get(appeal.username);
                if (userWs && userWs.readyState === WebSocket.OPEN) {
                    userWs.send(JSON.stringify({
                        type: 'appeal_result',
                        decision: data.decision,
                        text: data.decision === 'accepted' ? '你的申诉已被接受，账号已解封' : '你的申诉被拒绝'
                    }));
                }
                
                addAdminLog(currentUsername, data.decision === 'accepted' ? '接受申诉' : '拒绝申诉', `${appeal.username} - ${appeal.text}`);
                
                // 通知所有管理员更新申诉列表
                for (const [uname, ws] of userSessions.entries()) {
                    const user = users.get(uname);
                    if (user && (user.role === 'admin' || user.role === 'super_admin') && ws.readyState === WebSocket.OPEN) {
                        const pendingAppeals = appeals.filter(a => a.status === 'pending');
                        ws.send(JSON.stringify({
                            type: 'appeals_update',
                            appeals: pendingAppeals
                        }));
                    }
                }
            }

            // 管理功能
            if (data.type === 'admin_get_users') {
                if (!currentUsername) return;
                const adminUser = users.get(currentUsername);
                if (!adminUser || (adminUser.role !== 'admin' && adminUser.role !== 'super_admin')) return;
                
                ws.send(JSON.stringify({
                    type: 'admin_data',
                    dataType: 'users',
                    users: getAdminUsersList()
                }));
            }

            if (data.type === 'admin_get_stats') {
                if (!currentUsername) return;
                const adminUser = users.get(currentUsername);
                if (!adminUser || (adminUser.role !== 'admin' && adminUser.role !== 'super_admin')) return;
                
                ws.send(JSON.stringify({
                    type: 'admin_data',
                    dataType: 'stats',
                    stats: getMessageStats()
                }));
            }

            if (data.type === 'admin_get_messages') {
                if (!currentUsername) return;
                const adminUser = users.get(currentUsername);
                if (!adminUser || (adminUser.role !== 'admin' && adminUser.role !== 'super_admin')) return;
                
                const allMessages = [
                    ...messageHistory.map(m => ({...m, type: 'public', scope: 'public'})),
                    ...Array.from(privateMessages.values()).flat().filter(m => m.type === 'private')
                ];
                
                // 去重
                const uniqueMessages = [];
                const seenIds = new Set();
                allMessages.forEach(msg => {
                    if (!seenIds.has(msg.id)) {
                        seenIds.add(msg.id);
                        uniqueMessages.push(msg);
                    }
                });
                
                ws.send(JSON.stringify({
                    type: 'admin_data',
                    dataType: 'messages',
                    messages: uniqueMessages.slice(-100)
                }));
            }

            if (data.type === 'admin_get_logs') {
                if (!currentUsername) return;
                const adminUser = users.get(currentUsername);
                if (!adminUser || adminUser.role !== 'super_admin') return;
                
                ws.send(JSON.stringify({
                    type: 'admin_data',
                    dataType: 'logs',
                    logs: adminLogs.slice(-50)
                }));
            }

            if (data.type === 'ban_user') {
                if (!currentUsername) return;
                const adminUser = users.get(currentUsername);
                if (!adminUser || (adminUser.role !== 'admin' && adminUser.role !== 'super_admin')) return;
                
                const targetUser = users.get(data.username);
                if (!targetUser) return;
                if (targetUser.role === 'super_admin') {
                    ws.send(JSON.stringify({ type: 'admin_data', dataType: 'error', message: '不能封禁超级管理员' }));
                    return;
                }
                
                targetUser.banned = true;
                targetUser.banReason = data.reason || '违反规定';
                targetUser.banUntil = data.duration > 0 ? Date.now() + data.duration * 3600000 : null;
                
                // 保存用户数据
                dataManager.saveUsers(users);
                
                addAdminLog(currentUsername, '封禁用户', `${data.username} - 原因: ${data.reason} - 时长: ${data.duration}小时`);
                
                const targetWs = userSessions.get(data.username);
                if (targetWs) {
                    targetWs.close(1000, '被封禁');
                    userSessions.delete(data.username);
                }
                
                ws.send(JSON.stringify({ type: 'admin_data', dataType: 'users', users: getAdminUsersList() }));
            }

            if (data.type === 'unban_user') {
                if (!currentUsername) return;
                const adminUser = users.get(currentUsername);
                if (!adminUser || (adminUser.role !== 'admin' && adminUser.role !== 'super_admin')) return;
                
                const targetUser = users.get(data.username);
                if (!targetUser) return;
                
                targetUser.banned = false;
                targetUser.banReason = '';
                targetUser.banUntil = null;
                
                // 保存用户数据
                dataManager.saveUsers(users);
                
                addAdminLog(currentUsername, '解封用户', data.username);
                
                ws.send(JSON.stringify({ type: 'admin_data', dataType: 'users', users: getAdminUsersList() }));
            }

            // 禁言功能
            if (data.type === 'mute_user') {
                if (!currentUsername) return;
                const adminUser = users.get(currentUsername);
                if (!adminUser || (adminUser.role !== 'admin' && adminUser.role !== 'super_admin')) return;
                
                const targetUser = users.get(data.username);
                if (!targetUser) return;
                if (targetUser.role === 'super_admin') {
                    ws.send(JSON.stringify({ type: 'admin_data', dataType: 'error', message: '不能禁言超级管理员' }));
                    return;
                }
                
                targetUser.muted = true;
                targetUser.muteReason = data.reason || '违反规定';
                targetUser.muteUntil = data.duration > 0 ? Date.now() + data.duration * 60000 : null;
                
                // 保存用户数据
                dataManager.saveUsers(users);
                
                addAdminLog(currentUsername, '禁言用户', `${data.username} - 原因: ${data.reason} - 时长: ${data.duration}分钟`);
                
                const targetWs = userSessions.get(data.username);
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                    targetWs.send(JSON.stringify({
                        type: 'muted_notification',
                        reason: targetUser.muteReason,
                        remaining: data.duration
                    }));
                }
                
                ws.send(JSON.stringify({ type: 'admin_data', dataType: 'users', users: getAdminUsersList() }));
            }

            if (data.type === 'unmute_user') {
                if (!currentUsername) return;
                const adminUser = users.get(currentUsername);
                if (!adminUser || (adminUser.role !== 'admin' && adminUser.role !== 'super_admin')) return;
                
                const targetUser = users.get(data.username);
                if (!targetUser) return;
                
                targetUser.muted = false;
                targetUser.muteReason = '';
                targetUser.muteUntil = null;
                
                // 保存用户数据
                dataManager.saveUsers(users);
                
                addAdminLog(currentUsername, '解除禁言', data.username);
                
                const targetWs = userSessions.get(data.username);
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                    targetWs.send(JSON.stringify({
                        type: 'unmuted_notification'
                    }));
                }
                
                ws.send(JSON.stringify({ type: 'admin_data', dataType: 'users', users: getAdminUsersList() }));
            }

            if (data.type === 'delete_user') {
                if (!currentUsername) return;
                const adminUser = users.get(currentUsername);
                if (!adminUser || (adminUser.role !== 'admin' && adminUser.role !== 'super_admin')) return;
                
                const targetUser = users.get(data.username);
                if (!targetUser) return;
                
                if (targetUser.role === 'super_admin') {
                    ws.send(JSON.stringify({ type: 'admin_data', dataType: 'error', message: '不能删除超级管理员' }));
                    return;
                }
                
                users.delete(data.username);
                userSessions.delete(data.username);
                
                // 保存用户数据
                dataManager.saveUsers(users);
                
                addAdminLog(currentUsername, '删除用户', data.username);
                
                ws.send(JSON.stringify({ type: 'admin_data', dataType: 'users', users: getAdminUsersList() }));
            }

            if (data.type === 'reset_password') {
                if (!currentUsername) return;
                const adminUser = users.get(currentUsername);
                if (!adminUser || (adminUser.role !== 'admin' && adminUser.role !== 'super_admin')) return;
                
                const targetUser = users.get(data.username);
                if (!targetUser) return;
                
                targetUser.password = data.newPassword;
                
                // 保存用户数据
                dataManager.saveUsers(users);
                
                addAdminLog(currentUsername, '重置密码', data.username);
                
                ws.send(JSON.stringify({ type: 'admin_data', dataType: 'users', users: getAdminUsersList() }));
            }

            if (data.type === 'make_admin') {
                if (!currentUsername) return;
                const adminUser = users.get(currentUsername);
                if (!adminUser || adminUser.role !== 'super_admin') return;
                
                const targetUser = users.get(data.username);
                if (!targetUser) return;
                
                targetUser.role = 'admin';
                
                // 保存用户数据
                dataManager.saveUsers(users);
                
                addAdminLog(currentUsername, '设为管理员', data.username);
                
                ws.send(JSON.stringify({ type: 'admin_data', dataType: 'users', users: getAdminUsersList() }));
                
                const targetWs = userSessions.get(data.username);
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                    targetWs.send(JSON.stringify({
                        type: 'user_info',
                        user: getUserPublicData(data.username)
                    }));
                }
            }

            if (data.type === 'remove_admin') {
                if (!currentUsername) return;
                const adminUser = users.get(currentUsername);
                if (!adminUser || adminUser.role !== 'super_admin') return;
                
                const targetUser = users.get(data.username);
                if (!targetUser) return;
                
                targetUser.role = 'user';
                
                // 保存用户数据
                dataManager.saveUsers(users);
                
                addAdminLog(currentUsername, '取消管理员', data.username);
                
                ws.send(JSON.stringify({ type: 'admin_data', dataType: 'users', users: getAdminUsersList() }));
                
                const targetWs = userSessions.get(data.username);
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                    targetWs.send(JSON.stringify({
                        type: 'user_info',
                        user: getUserPublicData(data.username)
                    }));
                }
            }

            if (data.type === 'admin_delete_message') {
                if (!currentUsername) return;
                const adminUser = users.get(currentUsername);
                if (!adminUser || (adminUser.role !== 'admin' && adminUser.role !== 'super_admin')) return;
                
                const publicIndex = messageHistory.findIndex(m => m.id === data.messageId);
                if (publicIndex !== -1) {
                    messageHistory.splice(publicIndex, 1);
                    dataManager.saveMessageHistory(messageHistory);
                }
                
                for (const [key, messages] of privateMessages.entries()) {
                    const index = messages.findIndex(m => m.id === data.messageId);
                    if (index !== -1) {
                        messages.splice(index, 1);
                        dataManager.savePrivateMessages(privateMessages);
                    }
                }
                
                addAdminLog(currentUsername, '删除消息', data.messageId);
                
                broadcast({ type: 'message_deleted', messageId: data.messageId });
                
                // 重新获取消息列表
                const allMessages = [
                    ...messageHistory.map(m => ({...m, type: 'public', scope: 'public'})),
                    ...Array.from(privateMessages.values()).flat().filter(m => m.type === 'private')
                ];
                const uniqueMessages = [];
                const seenIds = new Set();
                allMessages.forEach(msg => {
                    if (!seenIds.has(msg.id)) {
                        seenIds.add(msg.id);
                        uniqueMessages.push(msg);
                    }
                });
                ws.send(JSON.stringify({ type: 'admin_data', dataType: 'messages', messages: uniqueMessages.slice(-100) }));
            }

            if (data.type === 'admin_recall_message') {
                if (!currentUsername) return;
                const adminUser = users.get(currentUsername);
                if (!adminUser || (adminUser.role !== 'admin' && adminUser.role !== 'super_admin')) return;
                
                let saved = false;
                const publicIndex = messageHistory.findIndex(m => m.id === data.messageId);
                if (publicIndex !== -1) {
                    messageHistory[publicIndex].text = '[消息已被撤回]';
                    messageHistory[publicIndex].recalled = true;
                    saved = true;
                }
                
                for (const [key, messages] of privateMessages.entries()) {
                    const index = messages.findIndex(m => m.id === data.messageId);
                    if (index !== -1) {
                        messages[index].text = '[消息已被撤回]';
                        messages[index].recalled = true;
                        saved = true;
                    }
                }
                
                if (saved) {
                    dataManager.saveMessageHistory(messageHistory);
                    dataManager.savePrivateMessages(privateMessages);
                }
                
                addAdminLog(currentUsername, '撤回消息', data.messageId);
                
                broadcast({ type: 'message_recalled', messageId: data.messageId });
            }

        } catch (e) {
            console.warn('消息解析错误:', e);
        }
    });

    ws.on('close', () => {
        if (currentUsername) {
            const user = users.get(currentUsername);
            if (user) {
                user.online = false;
                dataManager.saveUsers(users);
            }
            userSessions.delete(currentUsername);
            console.log(`用户 ${currentUsername} 断开连接`);
            broadcast({ type: 'system', text: `🔴 ${user ? user.nickname : currentUsername} 离开了聊天` });
            broadcastOnlineCount();
        }
    });

    ws.on('error', (err) => {
        console.error('WebSocket 错误:', err);
        if (currentUsername) {
            const user = users.get(currentUsername);
            if (user) {
                user.online = false;
                dataManager.saveUsers(users);
            }
            userSessions.delete(currentUsername);
            broadcastOnlineCount();
        }
    });
});

// 优雅关闭，保存数据
function gracefulShutdown() {
    console.log('\n🔄 正在保存数据...');
    saveAllData();
    console.log('✅ 所有数据已保存到硬盘');
    console.log('👋 服务器关闭');
    process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
    console.log(`📡 WebSocket 服务 ws://localhost:${PORT}/ws`);
    console.log(`👑 超级管理员账号: zuijiawzy 密码: zjwzy1111aw`);
    console.log(`👤 测试账号: test 密码: 123456`);
    console.log(`💾 数据存储目录: ${dataManager.DATA_DIR}`);
    console.log(`📦 数据文件: users.json, messages.json, privateMessages.json, friendRequests.json, appeals.json, adminLogs.json, systemAnnouncements.json`);
    console.log(`🔄 自动备份已启用，每24小时备份一次到 data/backups/`);
    console.log('');
    console.log('📌 ====== Zeabur 部署提示 ======');
    console.log('📌 请在 Zeabur 控制台设置 Health Check 路径为 /health');
    console.log('📌 建议 Health Check 间隔设为 30 秒');
    console.log('📌 ================================');
});