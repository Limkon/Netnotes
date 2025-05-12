// public/js/main.js - 客户端 JavaScript 逻辑 (简体中文)

// --- 全局变量 ---
let currentUsernameGlobal = '访客'; 
let currentUserRoleGlobal = 'anonymous'; 
let currentAdminIdGlobal = ''; 
let currentUserIdGlobal = ''; 
let savedRange = null; // 用于保存富文本编辑器的选区

// --- 通用函数 ---
async function fetchData(url, options = {}) {
    try {
        const response = await fetch(url, options);
        if (response.status === 401 && !(currentUserRoleGlobal === 'anonymous' && (options.method === 'GET' || !options.method))) {
            alert('您的会话已过期或未授权，请重新登录。');
            window.location.href = '/login';
            return null;
        }
        if (!response.ok) {
            let errorData;
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                errorData = await response.json();
            } else {
                errorData = await response.text();
            }
            console.error(`API 请求失败 (${response.status}):`, errorData);
            const errorMessage = (typeof errorData === 'object' && errorData !== null && errorData.message) ? errorData.message : (errorData || response.statusText);
            if ((response.status === 401 || response.status === 403) && currentUserRoleGlobal !== 'anonymous') {
                 alert('操作未授权或会话已过期，请重新登录。');
            }
            throw new Error(`服务器响应错误: ${response.status} ${errorMessage}`);
        }
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            return response.json();
        }
        return response.text();
    } catch (error) {
        console.error('Fetch API 调用失败:', error);
        const messageToDisplay = error.message || '与服务器通讯时发生错误。';
        let msgElementId = 'globalMessageArea'; 
        if (document.getElementById('formMessage')) msgElementId = 'formMessage'; 
        if (document.getElementById('adminMessages')) msgElementId = 'adminMessages'; 
        if (document.getElementById('registerMessage')) msgElementId = 'registerMessage'; 
        if (document.getElementById('changePasswordMessage')) msgElementId = 'changePasswordMessage'; 
        displayMessage(messageToDisplay, 'error', msgElementId);
        return null;
    }
}

function displayMessage(message, type = 'info', elementId = 'globalMessageArea') {
    const container = document.getElementById(elementId);
    if (container) {
        container.innerHTML = message ? `<div class="${type}-message">${escapeHtml(message)}</div>` : '';
        container.style.display = message ? 'block' : 'none';
    } else {
        if (type === 'error' && message) alert(`错误: ${message}`);
        else if (type === 'success' && message) alert(`成功: ${message}`);
        else if (message) alert(message);
    }
}

function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return String(unsafe);
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function setupNavigation(username, role, userId) {
    // 明确检查传入的值是否是模板占位符本身或表示未登录的默认值
    const isValidUser = username && username !== "{{username}}" && username !== "访客";
    const isValidRole = role && role !== "{{userRole}}" && role !== "anonymous";
    const isValidUserId = userId && userId !== "{{userId}}";

    currentUsernameGlobal = isValidUser ? username : '访客';
    currentUserRoleGlobal = isValidRole ? role : 'anonymous';
    currentUserIdGlobal = isValidUserId ? userId : '';

    const navContainer = document.getElementById('mainNav');
    const usernameDisplaySpan = document.getElementById('usernameDisplay'); // 独立的用户名称显示元素

    // 更新独立的 usernameDisplay (例如在 note.html, admin.html 的 header 中)
    if (usernameDisplaySpan) {
        usernameDisplaySpan.textContent = escapeHtml(currentUsernameGlobal);
    }
    
    if (!navContainer) { 
        // 对于没有 mainNav 的页面（例如登录页），确保其他地方的登出按钮（如果存在且未被 mainNav 包裹）也能工作
        document.querySelectorAll('#logoutButton:not([data-listener-attached])').forEach(button => {
            if (!button.closest('#mainNav')) { 
                button.addEventListener('click', handleLogout);
                button.setAttribute('data-listener-attached', 'true');
            }
        });
        return;
    }

    // 构建导航栏 HTML
    // 注意：如果 usernameDisplay 也在 mainNav 内部，则不需要上面的独立更新逻辑
    // 但为了兼容性，可以保留，或确保 mainNav 内的 usernameDisplay 有不同的 ID
    let navHtml = `<span class="welcome-user">欢迎, <strong id="usernameDisplayInNav">${escapeHtml(currentUsernameGlobal)}</strong>!</span>`;
    if (currentUserRoleGlobal === 'anonymous') {
        navHtml += `<a href="/login" class="button-action">登录</a>`;
        navHtml += `<a href="/register" class="button-action" style="background-color: #6c757d; border-color: #6c757d;">注册</a>`;
    } else {
        if (window.location.pathname !== '/' && window.location.pathname !== '/index.html') {
             navHtml += `<a href="/" class="button-action">返回列表</a>`;
        }
        if (window.location.pathname !== '/note/new' && !window.location.pathname.startsWith('/note/edit') && !window.location.pathname.startsWith('/note/view')) {
             navHtml += `<a href="/note/new" class="button-action">新建贴子</a>`;
        }
        if (window.location.pathname !== '/change-password') {
            navHtml += `<a href="/change-password" class="button-action">修改密码</a>`;
        }
        if (currentUserRoleGlobal === 'admin') {
            if (window.location.pathname !== '/admin/users') {
                navHtml += `<a href="/admin/users" id="adminUsersLink" class="button-action">管理用户</a>`;
            }
        }
        navHtml += `<button id="logoutButtonInNav" class="button-danger">登出</button>`;
    }
    navContainer.innerHTML = navHtml;
    
    const logoutButtonInNav = document.getElementById('logoutButtonInNav');
    if (logoutButtonInNav && !logoutButtonInNav.hasAttribute('data-listener-attached')) {
        logoutButtonInNav.addEventListener('click', handleLogout);
        logoutButtonInNav.setAttribute('data-listener-attached', 'true'); 
    }
}

async function handleLogout() {
    if (!confirm("您确定要登出吗？")) return;
    try {
        await fetchData('/logout', { method: 'POST' });
        window.location.href = '/login?logged_out=true';
    } catch (error) {
        console.error('登出请求错误:', error);
        alert('登出时发生错误。');
        window.location.href = '/login'; 
    }
}

async function loadNotes(searchTerm = '') { 
    const notesContainer = document.getElementById('notesContainer');
    const globalMessageArea = document.getElementById('globalMessageArea');
    const clearSearchButton = document.getElementById('clearSearchButton');

    if (globalMessageArea) displayMessage('', 'info', 'globalMessageArea');
    if (!notesContainer) return;
    notesContainer.innerHTML = '<p>正在加载贴子...</p>';

    let apiUrl = '/api/notes';
    if (searchTerm) {
        apiUrl += `?search=${encodeURIComponent(searchTerm)}`;
    }

    const notesData = await fetchData(apiUrl);
    if (!notesData) {
        notesContainer.innerHTML = `<p class="error-message">无法加载贴子。${searchTerm ? '请尝试其他关键字或清除搜索。' : '请检查网络连接或稍后再试。'}</p>`;
        if (searchTerm && clearSearchButton) clearSearchButton.style.display = 'inline-flex';
        return;
    }
    const notes = Array.isArray(notesData) ? notesData : [];
    if (notes.length === 0) {
        let noNotesMessage = `<p>${searchTerm ? `没有找到与“${escapeHtml(searchTerm)}”相关的贴子。` : '当前没有贴子。'}`;
        if (currentUserRoleGlobal !== 'anonymous' && !searchTerm) { 
            noNotesMessage += ' <a href="/note/new" class="button-action">创建您的第一篇贴子！</a>';
        }
        noNotesMessage += '</p>';
        notesContainer.innerHTML = noNotesMessage;
        if (searchTerm && clearSearchButton) { 
            clearSearchButton.style.display = 'inline-flex';
        } else if (clearSearchButton) {
            clearSearchButton.style.display = 'none';
        }
        return;
    }

    const ul = document.createElement('ul');
    ul.className = 'note-list';
    notes.forEach(note => {
        const li = document.createElement('li');
        li.className = 'note-item';
        li.id = `note-${note.id}`;
        let ownerInfo = (currentUserRoleGlobal === 'admin' || currentUserRoleGlobal === 'anonymous') && note.ownerUsername ? `<span class="note-owner">(所有者: ${escapeHtml(note.ownerUsername)})</span>` : '';
        
        let titleHtml = escapeHtml(note.title);
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = note.content; 
        const textContentForPreview = tempDiv.textContent || tempDiv.innerText || ""; 
        let contentPreviewHtml = escapeHtml(textContentForPreview.substring(0, 150) + (textContentForPreview.length > 150 ? '...' : ''));

        if (searchTerm) {
            const regex = new RegExp(`(${escapeHtml(searchTerm).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            titleHtml = titleHtml.replace(regex, '<mark>$1</mark>');
            contentPreviewHtml = contentPreviewHtml.replace(regex, '<mark>$1</mark>');
        }
        
        let attachmentHtml = '';
        if (note.attachment && note.attachment.path) { 
            const attachmentUrl = `/uploads/${encodeURIComponent(note.attachment.path)}`;
            attachmentHtml = `<div class="note-attachment">附件: <a href="${attachmentUrl}" target="_blank" title="下载 ${escapeHtml(note.attachment.originalName)}">${escapeHtml(note.attachment.originalName)}</a></div>`;
        }
        let actionsHtml = '';
        if (currentUserRoleGlobal !== 'anonymous' && (currentUserRoleGlobal === 'admin' || (note.userId === currentUserIdGlobal))) { 
            actionsHtml = `
                <div class="note-actions">
                    <a href="/note/edit?id=${note.id}" class="button-action">编辑</a>
                    <button class="button-danger" onclick="deleteNote('${note.id}', '${escapeHtml(note.title)}')">删除</button>
                </div>`;
        }
        const titleLink = `<a href="/note/view?id=${note.id}" class="note-title-link">${titleHtml}</a>`;

        li.innerHTML = `
            <div>
                <h3>${titleLink} ${ownerInfo}</h3>
                <div class="note-meta">
                    最后更新: ${new Date(note.updatedAt).toLocaleString('zh-CN')}
                    (创建于: ${new Date(note.createdAt).toLocaleString('zh-CN')})
                </div>
                <div class="note-content-preview">${contentPreviewHtml}</div>
                ${attachmentHtml}
            </div>
            ${actionsHtml}
        `;
        ul.appendChild(li);
    });
    notesContainer.innerHTML = '';
    notesContainer.appendChild(ul);
    if (searchTerm && clearSearchButton) {
        clearSearchButton.style.display = 'inline-flex';
    } else if (clearSearchButton) {
        clearSearchButton.style.display = 'none';
    }
}

async function deleteNote(noteId, noteTitle) {
    if (!confirm(`您确定要删除贴子 "${noteTitle}" 吗？此操作无法复原。`)) return;
    const result = await fetchData(`/api/notes/${noteId}`, { method: 'DELETE' });
    if (result && result.message) {
        displayMessage(result.message, 'success', 'globalMessageArea');
        const searchInput = document.getElementById('searchInput');
        loadNotes(searchInput ? searchInput.value.trim() : ''); 
    } else if (result) {
        displayMessage('贴子已删除，但服务器未返回确认消息。正在刷新列表...', 'info', 'globalMessageArea');
        const searchInput = document.getElementById('searchInput');
        loadNotes(searchInput ? searchInput.value.trim() : '');
    }
}

let isSubmittingNote = false;
function initializeRichTextEditor() {
    const toolbar = document.getElementById('richTextToolbar');
    const contentArea = document.getElementById('richContent');
    if (!toolbar || !contentArea) return;

    function saveSelection() {
        if (window.getSelection && window.getSelection().rangeCount > 0) {
            const selection = window.getSelection();
            if (contentArea.contains(selection.anchorNode) && contentArea.contains(selection.focusNode)) {
                return selection.getRangeAt(0).cloneRange();
            }
        }
        return null;
    }

    function restoreSelection(range) {
        if (range) {
            contentArea.focus(); 
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        } else {
            contentArea.focus(); 
        }
    }
    
    contentArea.addEventListener('focus', () => { savedRange = saveSelection(); });
    contentArea.addEventListener('blur', () => { savedRange = saveSelection(); });
    contentArea.addEventListener('click', () => { savedRange = saveSelection(); });
    contentArea.addEventListener('keyup', () => { savedRange = saveSelection(); });
    toolbar.addEventListener('mousedown', () => { savedRange = saveSelection(); });


    const fontNameSelector = document.getElementById('fontNameSelector');
    const fontSizeSelector = document.getElementById('fontSizeSelector');
    const foreColorPicker = document.getElementById('foreColorPicker');
    const insertLocalImageButton = document.getElementById('insertLocalImageButton');
    const imageUploadInput = document.getElementById('imageUploadInput');

    toolbar.addEventListener('click', (event) => {
        const targetButton = event.target.closest('button[data-command]');
        if (targetButton) {
            event.preventDefault();
            const command = targetButton.dataset.command;
            
            restoreSelection(savedRange); // 恢复选区前先聚焦

            if (command === 'createLink') {
                const selection = window.getSelection();
                let defaultUrl = 'https://';
                // 如果选区是一个链接，尝试获取其 href 作为默认值
                if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
                    let parentNode = selection.getRangeAt(0).commonAncestorContainer;
                    if (parentNode.nodeType !== Node.ELEMENT_NODE) {
                        parentNode = parentNode.parentNode;
                    }
                    if (parentNode && parentNode.tagName === 'A') {
                        defaultUrl = parentNode.getAttribute('href') || 'https://';
                    }
                }

                // 确保在 prompt 前保存一次最新的选区状态
                savedRange = saveSelection(); 
                const url = prompt('请输入链接网址:', defaultUrl);
                
                // 在 prompt 后，焦点可能已丢失，需要重新聚焦并恢复选区
                contentArea.focus(); 
                restoreSelection(savedRange);

                if (url && url.trim() !== "" && url.trim().toLowerCase() !== 'https://') {
                    document.execCommand('createLink', false, url.trim());
                } else if (url !== null) { // 用户点击了确定但输入无效或未改动默认的 "https://"
                    alert("您输入的链接无效或已取消。");
                }
                // 如果用户取消 prompt (url is null)，则不执行任何操作
            } else {
                document.execCommand(command, false, null); 
            }
            
            savedRange = saveSelection(); // 执行命令后更新选区
        }
    });

    if (fontNameSelector) {
        fontNameSelector.addEventListener('change', (event) => {
            restoreSelection(savedRange);
            document.execCommand('fontName', false, event.target.value);
            savedRange = saveSelection();
        });
    }
    if (fontSizeSelector) {
        fontSizeSelector.addEventListener('change', (event) => {
            restoreSelection(savedRange);
            document.execCommand('fontSize', false, event.target.value);
            savedRange = saveSelection();
        });
    }
    if (foreColorPicker) {
        foreColorPicker.addEventListener('input', (event) => { 
            restoreSelection(savedRange); 
            document.execCommand('foreColor', false, event.target.value);
        });
        foreColorPicker.addEventListener('change', (event) => { 
            restoreSelection(savedRange); 
            document.execCommand('foreColor', false, event.target.value);
            savedRange = saveSelection(); 
        });
    }

    if (insertLocalImageButton && imageUploadInput) {
        insertLocalImageButton.addEventListener('click', () => {
            savedRange = saveSelection(); 
            imageUploadInput.click();
        });
        imageUploadInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file && file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    restoreSelection(savedRange); 
                    document.execCommand('insertImage', false, e.target.result);
                    savedRange = saveSelection(); 
                };
                reader.readAsDataURL(file);
                imageUploadInput.value = ''; 
            } else if (file) {
                alert('请选择一个有效的图片文件 (例如 JPG, PNG, GIF)。');
            }
        });
    }
}

function setupNoteForm() {
    const noteForm = document.getElementById('noteForm');
    const richContent = document.getElementById('richContent');
    const hiddenContent = document.getElementById('hiddenContent');
    const saveButton = document.getElementById('saveNoteButton');
    if (noteForm && richContent && hiddenContent && saveButton) {
        noteForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (isSubmittingNote) return;
            isSubmittingNote = true;
            saveButton.disabled = true; saveButton.textContent = '保存中...';
            hiddenContent.value = richContent.innerHTML;
            const formData = new FormData(noteForm);
            const noteId = document.getElementById('noteId').value;
            const url = noteId ? `/api/notes/${noteId}` : '/api/notes';
            const method = noteId ? 'PUT' : 'POST';
            displayMessage('', 'info', 'formMessage');
            const result = await fetchData(url, { method: method, body: formData });
            if (result) {
                if (result.id && result.title) {
                    displayMessage(noteId ? '贴子已成功更新！' : '贴子已成功创建！', 'success', 'formMessage');
                    setTimeout(() => { window.location.href = '/'; }, 1500);
                } else if (result.message) displayMessage(result.message, 'error', 'formMessage');
                else if (typeof result === 'string' && result.includes("成功")) {
                     displayMessage(result, 'success', 'formMessage');
                     setTimeout(() => { window.location.href = '/'; }, 1500);
                }
            }
            isSubmittingNote = false;
            saveButton.disabled = false; saveButton.textContent = '保存';
        });
    }
}

async function loadNoteForEditing(noteId) {
    const note = await fetchData(`/api/notes/${noteId}`);
    const saveButton = document.getElementById('saveNoteButton');
    if (note) {
        document.getElementById('title').value = note.title;
        document.getElementById('richContent').innerHTML = note.content;
        const currentAttachmentDiv = document.getElementById('currentAttachment');
        const removeAttachmentContainer = document.getElementById('removeAttachmentContainer');
        if (note.attachment && note.attachment.path) {
            const attachmentUrl = `/uploads/${encodeURIComponent(note.attachment.path)}`;
            currentAttachmentDiv.innerHTML = `当前附件: <a href="${attachmentUrl}" target="_blank">${escapeHtml(note.attachment.originalName)}</a>`;
            removeAttachmentContainer.style.display = 'block';
            document.getElementById('removeAttachmentCheckbox').checked = false;
        } else {
            currentAttachmentDiv.innerHTML = '当前没有附件。';
            removeAttachmentContainer.style.display = 'none';
        }
    } else {
        displayMessage('无法加载贴子进行编辑。', 'error', 'formMessage');
        if(saveButton) saveButton.disabled = true;
    }
}

async function loadUsersForAdmin(currentAdminId) { 
    const userListUl = document.getElementById('userList');
    if (!userListUl) return;
    userListUl.innerHTML = '<li>正在加载用户列表...</li>';
    const usersData = await fetchData('/api/admin/users');
     if (!usersData) {
        if(!userListUl.querySelector('.error-message')) userListUl.innerHTML = '<li class="error-message">无法加载用户列表。</li>';
        return;
    }
    const users = Array.isArray(usersData) ? usersData : [];
    if (users.length === 0) {
        userListUl.innerHTML = '<li>当前没有其他用户。</li>';
        return;
    }
    userListUl.innerHTML = '';
    users.forEach(user => {
        const li = document.createElement('li');
        li.className = 'user-item';
        li.id = `user-admin-${user.id}`;
        const userInfoSpan = document.createElement('span');
        userInfoSpan.innerHTML = `<strong>${escapeHtml(user.username)}</strong> (ID: ${user.id}, 角色: ${escapeHtml(user.role)})`;
        li.appendChild(userInfoSpan);
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'user-item-actions';
        actionsDiv.style.display = 'flex';
        actionsDiv.style.gap = '10px';
        if (user.id !== currentAdminId) { 
            const resetPassButton = document.createElement('button');
            resetPassButton.className = 'button-action';
            resetPassButton.textContent = '重设密码';
            resetPassButton.style.padding = '0.3rem 0.6rem';
            resetPassButton.style.fontSize = '0.85rem';
            resetPassButton.onclick = () => showPasswordResetForm(user.id, user.username, li);
            actionsDiv.appendChild(resetPassButton);
            const deleteButton = document.createElement('button');
            deleteButton.className = 'button-danger';
            deleteButton.textContent = '删除';
            deleteButton.onclick = () => deleteUserByAdmin(user.id, user.username);
            actionsDiv.appendChild(deleteButton);
        } else {
            const selfSpan = document.createElement('span');
            selfSpan.style.fontSize = '0.8em';
            selfSpan.style.color = '#5f6368';
            selfSpan.textContent = '(当前登录)';
            actionsDiv.appendChild(selfSpan);
        }
        li.appendChild(actionsDiv);
        userListUl.appendChild(li);
    });
}

let isUpdatingPasswordByAdmin = false; 
function showPasswordResetForm(userId, username, listItemElement) {
    const existingForms = document.querySelectorAll('.password-edit-form-container');
    existingForms.forEach(form => form.remove());
    const formContainer = document.createElement('div');
    formContainer.className = 'password-edit-form-container';
    formContainer.style.marginTop = '10px';
    formContainer.style.padding = '15px';
    formContainer.style.border = '1px solid #ccc';
    formContainer.style.borderRadius = '4px';
    formContainer.style.backgroundColor = '#f9f9f9';
    const form = document.createElement('form');
    form.id = `passwordEditForm-${userId}`;
    
    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.className = 'button-action';
    saveButton.textContent = '保存新密码';
    saveButton.style.marginRight = '10px';

    form.onsubmit = (event) => handleUpdatePasswordByAdmin(event, userId, username, saveButton); 

    const currentUserP = document.createElement('p');
    currentUserP.innerHTML = `正在为用户 <strong>${escapeHtml(username)}</strong> 重设密码。`;
    currentUserP.style.marginBottom = '10px';
    const passwordLabel = document.createElement('label');
    passwordLabel.htmlFor = `newPass-${userId}`;
    passwordLabel.textContent = `新密码:`;
    passwordLabel.style.display = 'block';
    passwordLabel.style.marginBottom = '5px';
    const passwordInput = document.createElement('input');
    passwordInput.type = 'password';
    passwordInput.id = `newPass-${userId}`;
    passwordInput.name = 'newPassword';
    passwordInput.placeholder = "输入新密码 (普通用户可为空)";
    passwordInput.style.marginBottom = '10px';
    passwordInput.style.width = 'calc(100% - 16px)';
    
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'button-action button-cancel';
    cancelButton.textContent = '取消';
    cancelButton.onclick = () => formContainer.remove();
    form.appendChild(currentUserP);
    form.appendChild(passwordLabel);
    form.appendChild(passwordInput);
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'form-actions';
    actionsDiv.appendChild(saveButton);
    actionsDiv.appendChild(cancelButton);
    form.appendChild(actionsDiv);
    formContainer.appendChild(form);
    listItemElement.appendChild(formContainer);
    passwordInput.focus();
}

async function handleUpdatePasswordByAdmin(event, userId, username, saveButtonElement) {
    event.preventDefault();
    if (isUpdatingPasswordByAdmin) return;

    isUpdatingPasswordByAdmin = true;
    if(saveButtonElement) {
        saveButtonElement.disabled = true;
        saveButtonElement.textContent = '保存中...';
    }

    const form = event.target;
    const newPasswordInput = form.newPassword;
    const newPassword = newPasswordInput.value;
    const messageContainerId = 'adminMessages';
    displayMessage('正在更新密码...', 'info', messageContainerId);
    const result = await fetchData(`/api/admin/users/${userId}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: newPassword })
    });
    if (result && result.message && (result.message.includes("成功") || !result.message.toLowerCase().includes("错误"))) {
        displayMessage(result.message, 'success', messageContainerId);
        const formContainer = form.closest('.password-edit-form-container');
        if (formContainer) formContainer.remove();
    } else if (result && result.message) {
        displayMessage(result.message, 'error', messageContainerId);
    }

    isUpdatingPasswordByAdmin = false;
    if(saveButtonElement) {
        saveButtonElement.disabled = false;
        saveButtonElement.textContent = '保存新密码';
    }
}

let isAdminAddingUser = false; 
function setupAdminUserForm() {
    const addUserForm = document.getElementById('addUserForm');
    const addUserButton = addUserForm ? addUserForm.querySelector('button[type="submit"]') : null;

    if (addUserForm && addUserButton) {
        addUserForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (isAdminAddingUser) return; 

            isAdminAddingUser = true;
            addUserButton.disabled = true;
            addUserButton.textContent = '正在添加...';

            const formData = new FormData(addUserForm);
            const data = Object.fromEntries(formData.entries());
            if (!data.username || data.username.trim() === '') {
                displayMessage('用户名不能为空。', 'error', 'adminMessages');
                isAdminAddingUser = false;
                addUserButton.disabled = false;
                addUserButton.textContent = '新建用户';
                return;
            }
            if (data.role === 'admin' && (!data.password || data.password.trim() === '')) {
                displayMessage('管理员的密码不能为空。', 'error', 'adminMessages');
                isAdminAddingUser = false;
                addUserButton.disabled = false;
                addUserButton.textContent = '新建用户';
                return;
            }
            displayMessage('', 'info', 'adminMessages'); 
            const result = await fetchData('/api/admin/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (result && result.id) {
                displayMessage(`用户 "${escapeHtml(result.username)}" 已成功创建。`, 'success', 'adminMessages');
                addUserForm.reset();
                loadUsersForAdmin(currentAdminIdGlobal);
            } else if (result && result.message) {
                 displayMessage(result.message, 'error', 'adminMessages');
            }
            
            isAdminAddingUser = false;
            addUserButton.disabled = false;
            addUserButton.textContent = '新建用户';
        });
    }
}

async function deleteUserByAdmin(userId, username) {
    if (!confirm(`您确定要删除用户 "${username}" (ID: ${userId}) 吗？此操作将同时删除该用户的所有贴子和附件，且无法复原。`)) return;
    displayMessage('', 'info', 'adminMessages');
    const result = await fetchData(`/api/admin/users/${userId}`, { method: 'DELETE' });
    if (result && result.message && (result.message.includes("成功") || !result.message.toLowerCase().includes("错误") && !result.message.toLowerCase().includes("失败"))) {
        displayMessage(result.message, 'success', 'adminMessages');
        loadUsersForAdmin(currentAdminIdGlobal);
    } else if (result && result.message) {
         displayMessage(result.message, 'error', 'adminMessages');
    }
}

let isRegistering = false;
function setupRegistrationForm() {
    const registerForm = document.getElementById('registerForm');
    const registerButton = document.getElementById('registerButton');
    if (registerForm && registerButton) {
        registerForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (isRegistering) return;
            const usernameInput = document.getElementById('regUsername');
            const passwordInput = document.getElementById('regPassword');
            const confirmPasswordInput = document.getElementById('regConfirmPassword');
            const messageContainerId = 'registerMessage';
            const username = usernameInput.value.trim();
            const password = passwordInput.value;
            const confirmPassword = confirmPasswordInput.value;
            displayMessage('', 'info', messageContainerId);
            if (!username) {
                displayMessage('用户名不能为空。', 'error', messageContainerId); return;
            }
            if (password !== confirmPassword) {
                displayMessage('两次输入的密码不相符。', 'error', messageContainerId); return;
            }
            isRegistering = true;
            registerButton.disabled = true; registerButton.textContent = '注册中...';
            const result = await fetchData('/api/users/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            if (result && result.id) {
                displayMessage('注册成功！您现在可以前往登录页面登录。', 'success', messageContainerId);
                registerForm.reset();
                setTimeout(() => { window.location.href = '/login?registered=true'; }, 2000);
            } else if (result && result.message) {
                 displayMessage(result.message, 'error', messageContainerId);
            }
            isRegistering = false;
            registerButton.disabled = false; registerButton.textContent = '注册';
        });
    }
}

let isChangingOwnPassword = false;
function setupChangeOwnPasswordForm() {
    const form = document.getElementById('changeOwnPasswordForm');
    const submitButton = document.getElementById('submitChangePassword');
    const messageContainerId = 'changePasswordMessage';

    if (form && submitButton) {
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (isChangingOwnPassword) return;
            const currentPassword = document.getElementById('currentPassword').value;
            const newPassword = document.getElementById('newPasswordUser').value;
            const confirmNewPassword = document.getElementById('confirmNewPasswordUser').value;
            displayMessage('', 'info', messageContainerId);
            if (newPassword !== confirmNewPassword) {
                displayMessage('新密码和确认密码不匹配。', 'error', messageContainerId);
                return;
            }
            isChangingOwnPassword = true;
            submitButton.disabled = true;
            submitButton.textContent = '正在提交...';
            const result = await fetchData('/api/users/me/password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword, newPassword, confirmNewPassword })
            });
            if (result && result.message && result.message.includes("成功")) {
                displayMessage(result.message + ' 您可能需要重新登录。', 'success', messageContainerId);
                form.reset();
                setTimeout(() => {
                     handleLogout();
                }, 2500);
            } else if (result && result.message) {
                displayMessage(result.message, 'error', messageContainerId);
            }
            isChangingOwnPassword = false;
            submitButton.disabled = false;
            submitButton.textContent = '确认修改';
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;
    
    // 这些变量应该由每个HTML页面的内联脚本通过服务器端模板注入来定义
    const usernameFromServer = (typeof currentUsername !== 'undefined' && currentUsername !== "{{username}}") ? currentUsername : '访客';
    const roleFromServer = (typeof currentUserRole !== 'undefined' && currentUserRole !== "{{userRole}}") ? currentUserRole : 'anonymous';
    const userIdFromServer = (typeof currentUserId !== 'undefined' && currentUserId !== "{{userId}}") ? currentUserId : ''; 
    const adminIdFromServer = (typeof currentAdminId !== 'undefined' && currentAdminId !== "{{adminUserId}}") ? currentAdminId : '';

    currentAdminIdGlobal = adminIdFromServer; 
    currentUserIdGlobal = userIdFromServer;   

    setupNavigation(usernameFromServer, roleFromServer, userIdFromServer);


    if (path === '/' || path === '/index.html') {
        const urlParams = new URLSearchParams(window.location.search);
        const initialSearchTerm = urlParams.get('search') || '';
        const searchInput = document.getElementById('searchInput');
        if (searchInput && initialSearchTerm) {
            searchInput.value = initialSearchTerm;
        }
        loadNotes(initialSearchTerm); 
        const clearSearchButton = document.getElementById('clearSearchButton');
        if (initialSearchTerm && clearSearchButton) {
            clearSearchButton.style.display = 'inline-flex';
        } else if (clearSearchButton) {
            clearSearchButton.style.display = 'none';
        }
        const searchForm = document.getElementById('searchForm');
        if (searchForm && searchInput && clearSearchButton) {
             searchForm.addEventListener('submit', (event) => {
                event.preventDefault();
                const searchTerm = searchInput.value.trim();
                loadNotes(searchTerm); 
                if (searchTerm) {
                    clearSearchButton.style.display = 'inline-flex';
                } else {
                    clearSearchButton.style.display = 'none';
                }
            });
            clearSearchButton.addEventListener('click', () => {
                searchInput.value = '';
                loadNotes(); 
                clearSearchButton.style.display = 'none';
            });
        }
    } else if (path.startsWith('/note/')) {
        if (path.startsWith('/note/new') || path.startsWith('/note/edit')) {
            initializeRichTextEditor();
            setupNoteForm();
            const urlParams = new URLSearchParams(window.location.search);
            const noteId = urlParams.get('id');
            if (noteId && path.startsWith('/note/edit')) { 
                loadNoteForEditing(noteId);
            }
        }
    } else if (path === '/admin/users') {
        loadUsersForAdmin(currentAdminIdGlobal); 
        setupAdminUserForm();
    } else if (path === '/register') {
        setupRegistrationForm();
    } else if (path === '/change-password') {
        setupChangeOwnPasswordForm();
    }
});
