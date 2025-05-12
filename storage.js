// storage.js - 数据持久化逻辑 (读写JSON文件, 密码加密)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const NOTES_FILE = path.join(DATA_DIR, 'notes.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

const HASH_ITERATIONS = 100000;
const HASH_KEYLEN = 64;
const HASH_DIGEST = 'sha512';
const SALT_LEN = 16;

function generateSalt() {
    return crypto.randomBytes(SALT_LEN).toString('hex');
}

function hashPassword(password, salt) {
    if (!password) return '';
    return crypto.pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_KEYLEN, HASH_DIGEST).toString('hex');
}

function readJsonFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            if (filePath === USERS_FILE || filePath === NOTES_FILE) {
                fs.writeFileSync(filePath, '[]', 'utf8');
                return [];
            }
            return null;
        }
        const fileContent = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(fileContent);
    } catch (e) {
        console.error(`读取 JSON 文件 ${filePath} 失败:`, e);
        return [];
    }
}

function writeJsonFile(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error(`写入 JSON 文件 ${filePath} 失败:`, e);
    }
}

module.exports = {
    UPLOADS_DIR,
    hashPassword,
    generateSalt,

    getUsers: () => readJsonFile(USERS_FILE),
    saveUser: (userData) => {
        const users = readJsonFile(USERS_FILE);
        let userToSave = { ...userData };
        let isUpdating = false;

        // 检查是否为更新操作 (通过ID判断)
        if (userToSave.id) {
            const existingUserIndex = users.findIndex(u => u.id === userToSave.id);
            if (existingUserIndex > -1) {
                isUpdating = true;
                // 合并现有用户信息，确保 salt 等不会丢失，除非新密码被提供
                const existingUser = users[existingUserIndex];
                userToSave = { ...existingUser, ...userToSave };
            }
        }

        // 用户名冲突检查 (对于新用户，或更新用户时更改了用户名)
        // 如果不是 "anyone" 用户，并且用户名已存在于另一个不同的用户记录中
        const conflictingUser = users.find(u => u.username === userToSave.username && u.id !== userToSave.id);
        if (conflictingUser && userToSave.username !== 'anyone') {
            console.error(`保存用户错误：用户名 "${userToSave.username}" 已被用户 ID "${conflictingUser.id}" 使用。`);
            return null; // 明确返回 null 表示保存失败
        }

        // 处理 "anyone" 用户的特殊逻辑
        if (userToSave.username === 'anyone') {
            userToSave.role = 'anonymous';
            delete userToSave.password; // 确保明文密码字段被移除
            userToSave.salt = null;
            userToSave.hashedPassword = null;
        } else if (userData.hasOwnProperty('password')) { // 只有当传入的 userData 明确包含 password 属性时才处理密码
            if (!userToSave.salt && !isUpdating) { // 新用户或密码首次被设置
                userToSave.salt = generateSalt();
            } else if (!userToSave.salt && isUpdating && userData.password !== undefined) {
                // 如果是更新用户，且旧用户没有salt（例如从旧数据迁移），但新提供了密码
                userToSave.salt = generateSalt();
            }
            // 如果 salt 存在 (来自现有用户或刚生成)，并且提供了密码，则哈希
            if (userToSave.salt) {
                 userToSave.hashedPassword = userData.password ? hashPassword(userData.password, userToSave.salt) : '';
            } else if (userData.password === '') { // 如果想设置空密码且之前没有salt
                 userToSave.hashedPassword = '';
            }
            delete userToSave.password;
        }


        if (!userToSave.id) { // 为全新用户生成 ID
            userToSave.id = (userToSave.username === 'anyone') ?
                            `user_anyone_${Date.now()}` :
                            `user_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        }
        
        const existingIndexById = users.findIndex(u => u.id === userToSave.id);

        if (existingIndexById > -1) { // 更新
            users[existingIndexById] = userToSave; // 直接使用已合并和处理过的 userToSave
        } else { // 新增
            // 在此之前，用户名冲突应已被上面的逻辑捕获并返回 null
            users.push(userToSave);
        }
        writeJsonFile(USERS_FILE, users);
        const { salt, hashedPassword, ...safeUser } = userToSave;
        return safeUser;
    },
    findUserByUsername: (username) => {
        const user = readJsonFile(USERS_FILE).find(u => u.username === username);
        return user || null;
    },
    findUserById: (id) => {
        const user = readJsonFile(USERS_FILE).find(u => u.id === id);
        return user || null;
    },
    deleteUser: (userId) => {
        let users = readJsonFile(USERS_FILE);
        const initialLength = users.length;
        users = users.filter(u => u.id !== userId);
        if (users.length < initialLength) {
            writeJsonFile(USERS_FILE, users);
            let notes = readJsonFile(NOTES_FILE);
            const userNotes = notes.filter(note => note.userId === userId);
            userNotes.forEach(note => {
                if (note.attachment && note.attachment.path) {
                    const attachmentFullPath = path.join(UPLOADS_DIR, note.attachment.path);
                    if (fs.existsSync(attachmentFullPath)) {
                        try { fs.unlinkSync(attachmentFullPath); }
                        catch (e) { console.error(`删除用户 ${userId} 的附件 ${attachmentFullPath} 失败:`, e); }
                    }
                }
            });
            notes = notes.filter(note => note.userId !== userId);
            writeJsonFile(NOTES_FILE, notes);
            const userUploadDir = path.join(UPLOADS_DIR, userId);
            if (fs.existsSync(userUploadDir)) {
                try { fs.rmSync(userUploadDir, { recursive: true, force: true }); }
                catch(e) { console.error(`删除用户 ${userId} 的上传目录 ${userUploadDir} 失败:`, e); }
            }
            return true;
        }
        return false;
    },

    getNotes: () => readJsonFile(NOTES_FILE),
    saveNote: (note) => {
        const notes = readJsonFile(NOTES_FILE);
        if (!note.id) {
            note.id = `note_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            note.createdAt = new Date().toISOString();
            note.updatedAt = new Date().toISOString();
            notes.push(note);
        } else {
            const index = notes.findIndex(n => n.id === note.id);
            if (index > -1) {
                notes[index] = { ...notes[index], ...note, updatedAt: new Date().toISOString() };
            } else {
                return null;
            }
        }
        writeJsonFile(NOTES_FILE, notes);
        return note;
    },
    findNoteById: (id) => readJsonFile(NOTES_FILE).find(n => n.id === id),
    deleteNote: (noteId) => {
        let notes = readJsonFile(NOTES_FILE);
        const noteToDelete = notes.find(n => n.id === noteId);
        if (!noteToDelete) return false;
        if (noteToDelete.attachment && noteToDelete.attachment.path) {
            const attachmentFullPath = path.join(UPLOADS_DIR, noteToDelete.attachment.path);
            if (fs.existsSync(attachmentFullPath)) {
                try { fs.unlinkSync(attachmentFullPath); }
                catch (e) { console.error(`删除附件 ${attachmentFullPath} 失败:`, e); }
            }
        }
        const initialLength = notes.length;
        notes = notes.filter(n => n.id !== noteId);
        if (notes.length < initialLength) {
            writeJsonFile(NOTES_FILE, notes);
            return true;
        }
        return false;
    }
};
