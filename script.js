/* =====================================
   APPLICATION STATE
===================================== */

let users = [];
let posts = [];
let notifications = [];
let currentUser = null;
let savedPosts = [];
let activeFilter = localStorage.getItem("siddverse_filter") || "latest";
let activeStoryCategory = "all";
let viewingProfileUsername = null;
let resetPasswordTargetUser = null;
let activeAdminTab = "users";
let isLocalFallback = window.location.protocol === "file:";

let adminData = {
    stats: null,
    users: [],
    posts: [],
    comments: []
};

/* =====================================
   STANDALONE / LOCALSTORAGE MOCK DB
===================================== */

const MOCK_STORAGE_KEY = "siddverse_local_database_v2";

function getLocalDB() {
    let raw = localStorage.getItem(MOCK_STORAGE_KEY);
    if (!raw) {
        const initialDB = {
            users: [
                {
                    username: "admin",
                    name: "System Administrator",
                    password: "1234",
                    bio: "Official SiddVerse Platform Administrator 🛡️",
                    avatar: "",
                    cover: "",
                    isAdmin: true,
                    followers: ["siddhant", "priya", "rahul"],
                    following: ["siddhant"]
                },
                {
                    username: "siddhant",
                    name: "Siddhant",
                    password: "1234",
                    bio: "Building ideas that matter. 🚀 Founder & Admin.",
                    avatar: "",
                    cover: "",
                    isAdmin: true,
                    followers: ["priya", "rahul", "admin"],
                    following: ["priya", "admin"]
                },
                {
                    username: "priya",
                    name: "Priya Sharma",
                    password: "1234",
                    bio: "Photography & Travel 📸",
                    avatar: "",
                    cover: "",
                    isAdmin: false,
                    followers: ["siddhant"],
                    following: ["siddhant", "rahul", "admin"]
                },
                {
                    username: "rahul",
                    name: "Rahul Patil",
                    password: "1234",
                    bio: "Coding enthusiast 💻",
                    avatar: "",
                    cover: "",
                    isAdmin: false,
                    followers: ["priya"],
                    following: ["siddhant", "admin"]
                }
            ],
            posts: [
                {
                    id: 1,
                    username: "siddhant",
                    text: "Just launched a fresh idea for a student community app. Feedback would help a lot!",
                    image: "",
                    createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
                    likes: ["priya"],
                    comments: [
                        { id: 1, username: "rahul", text: "This looks awesome!", date: new Date(Date.now() - 20 * 60 * 1000).toISOString() }
                    ]
                },
                {
                    id: 2,
                    username: "priya",
                    text: "Weekend photo walk and a new reel idea. What do you think of this aesthetic?",
                    image: "https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=1200&q=80",
                    createdAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
                    likes: ["siddhant", "rahul"],
                    comments: [
                        { id: 2, username: "siddhant", text: "Love the vibe.", date: new Date(Date.now() - 80 * 60 * 1000).toISOString() }
                    ]
                },
                {
                    id: 3,
                    username: "rahul",
                    text: "Building a cleaner UI always feels like a productivity boost. Small improvements matter a lot. #coding #tech",
                    image: "",
                    createdAt: new Date(Date.now() - 180 * 60 * 1000).toISOString(),
                    likes: ["siddhant"],
                    comments: [
                        { id: 3, username: "priya", text: "Totally agree.", date: new Date(Date.now() - 170 * 60 * 1000).toISOString() }
                    ]
                }
            ],
            notifications: [
                { to: "siddhant", from: "rahul", text: "commented on your post 💬", date: new Date(Date.now() - 20 * 60 * 1000).toISOString(), read: false },
                { to: "siddhant", from: "priya", text: "liked your post ❤️", date: new Date(Date.now() - 25 * 60 * 1000).toISOString(), read: false }
            ],
            savedPosts: {},
            currentUser: null
        };
        localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(initialDB));
        return initialDB;
    }
    try {
        return JSON.parse(raw);
    } catch {
        localStorage.removeItem(MOCK_STORAGE_KEY);
        return getLocalDB();
    }
}

function saveLocalDB(db) {
    localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(db));
}

function handleLocalApiRequest(path, options = {}) {
    const url = new URL(path, "http://localhost");
    const pathname = url.pathname;
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : {};
    const db = getLocalDB();

    if (pathname === "/api/bootstrap" && method === "GET") {
        if (!db.currentUser) {
            return { authenticated: false };
        }
        const curr = db.users.find(u => u.username === db.currentUser);
        if (!curr) {
            db.currentUser = null;
            saveLocalDB(db);
            return { authenticated: false };
        }
        return {
            authenticated: true,
            currentUser: db.currentUser,
            isAdmin: Boolean(curr.isAdmin),
            users: db.users.map(u => ({
                username: u.username,
                name: u.name,
                bio: u.bio || "",
                avatar: u.avatar || "",
                cover: u.cover || "",
                isAdmin: Boolean(u.isAdmin),
                followers: u.followers || [],
                following: u.following || []
            })),
            posts: db.posts.map(p => ({
                ...p,
                likes: p.likes || [],
                comments: p.comments || []
            })),
            notifications: (db.notifications || []).filter(n => n.to === db.currentUser),
            savedPosts: (db.savedPosts && db.savedPosts[db.currentUser]) || []
        };
    }

    if (pathname === "/api/auth/login" && method === "POST") {
        const username = (body.username || "").trim().toLowerCase();
        const password = body.password || "";
        const user = db.users.find(u => u.username === username);
        if (!user || user.password !== password) {
            throw new Error("Invalid username or password.");
        }
        db.currentUser = username;
        saveLocalDB(db);
        return { user: { ...user, password: "" } };
    }

    if (pathname === "/api/auth/register" && method === "POST") {
        const name = (body.name || "").trim();
        const username = (body.username || "").trim().toLowerCase();
        const password = body.password || "";
        if (!name || username.length < 3 || password.length < 4) {
            throw new Error("Enter valid name, username (min 3 chars), and password (min 4 chars).");
        }
        if (db.users.find(u => u.username === username)) {
            throw new Error("Username already exists.");
        }
        const newUser = {
            username,
            name,
            password,
            bio: "Welcome to SiddVerse! ✨",
            avatar: "",
            cover: "",
            isAdmin: false,
            followers: [],
            following: []
        };
        db.users.push(newUser);
        saveLocalDB(db);
        return { user: { ...newUser, password: "" } };
    }

    if (pathname === "/api/auth/session" && method === "DELETE") {
        db.currentUser = null;
        saveLocalDB(db);
        return { ok: true };
    }

    if (pathname === "/api/posts" && method === "POST") {
        const text = (body.text || "").trim();
        const image = (body.image || "").trim();
        const pollQuestion = (body.pollQuestion || "").trim();
        const pollOptions = Array.isArray(body.pollOptions) ? body.pollOptions.map(o => String(o).trim()).filter(Boolean) : [];

        let poll = null;
        if (pollQuestion && pollOptions.length >= 2) {
            poll = {
                question: pollQuestion,
                options: pollOptions.map(opt => ({ text: opt, votes: 0 })),
                totalVotes: 0,
                userVote: null
            };
        }

        const newPost = {
            id: Date.now(),
            username: db.currentUser,
            text,
            image,
            createdAt: new Date().toISOString(),
            isEdited: false,
            poll,
            likes: [],
            comments: []
        };
        db.posts.unshift(newPost);
        saveLocalDB(db);
        return { id: newPost.id };
    }

    // Single comment deletion
    const commentMatch = pathname.match(/^\/api\/comments\/(\d+)$/);
    if (commentMatch && method === "DELETE") {
        const commentId = Number(commentMatch[1]);
        let found = false;
        db.posts.forEach(p => {
            if (p.comments) {
                const prevLen = p.comments.length;
                p.comments = p.comments.filter(c => c.id !== commentId);
                if (p.comments.length !== prevLen) found = true;
            }
        });
        saveLocalDB(db);
        return { ok: true };
    }

    // Post actions (like, comments, save, vote, edit, delete)
    const postMatch = pathname.match(/^\/api\/posts\/(\d+)(?:\/(like|comments|save|vote))?$/);
    if (postMatch) {
        const postId = Number(postMatch[1]);
        const action = postMatch[2] || "";
        const post = db.posts.find(p => p.id === postId);

        if (!action && method === "DELETE") {
            db.posts = db.posts.filter(p => p.id !== postId);
            saveLocalDB(db);
            return { ok: true };
        }

        if (!action && method === "PATCH") {
            if (post) {
                if (body.text !== undefined) post.text = String(body.text).trim();
                if (body.image !== undefined) post.image = String(body.image).trim();
                post.isEdited = true;
                saveLocalDB(db);
                return { ok: true };
            }
        }

        if (post) {
            if (action === "vote" && method === "POST") {
                if (post.poll && post.poll.options) {
                    const optIdx = Number(body.optionIndex);
                    if (optIdx >= 0 && optIdx < post.poll.options.length) {
                        db.pollVotes = db.pollVotes || {};
                        const voteKey = `${postId}_${db.currentUser}`;
                        const prevVote = db.pollVotes[voteKey];
                        if (prevVote !== undefined && post.poll.options[prevVote]) {
                            post.poll.options[prevVote].votes = Math.max(0, (post.poll.options[prevVote].votes || 0) - 1);
                        } else {
                            post.poll.totalVotes = (post.poll.totalVotes || 0) + 1;
                        }
                        post.poll.options[optIdx].votes = (post.poll.options[optIdx].votes || 0) + 1;
                        db.pollVotes[voteKey] = optIdx;
                        post.poll.userVote = optIdx;
                        saveLocalDB(db);
                        return { ok: true, optionIndex: optIdx };
                    }
                }
            }

            if (action === "like" && method === "POST") {
                post.likes = post.likes || [];
                const idx = post.likes.indexOf(db.currentUser);
                if (idx > -1) {
                    post.likes.splice(idx, 1);
                } else {
                    post.likes.push(db.currentUser);
                    if (post.username !== db.currentUser) {
                        db.notifications = db.notifications || [];
                        db.notifications.push({
                            to: post.username,
                            from: db.currentUser,
                            text: "liked your post ❤️",
                            date: new Date().toISOString(),
                            read: false
                        });
                    }
                }
                saveLocalDB(db);
                return { liked: idx === -1 };
            }

            if (action === "comments" && method === "POST") {
                post.comments = post.comments || [];
                const newComment = {
                    id: Date.now(),
                    username: db.currentUser,
                    text: body.text.trim(),
                    date: new Date().toISOString()
                };
                post.comments.push(newComment);
                if (post.username !== db.currentUser) {
                    db.notifications = db.notifications || [];
                    db.notifications.push({
                        to: post.username,
                        from: db.currentUser,
                        text: "commented on your post 💬",
                        date: new Date().toISOString(),
                        read: false
                    });
                }
                saveLocalDB(db);
                return { ok: true, id: newComment.id };
            }

            if (action === "save" && method === "POST") {
                db.savedPosts = db.savedPosts || {};
                db.savedPosts[db.currentUser] = db.savedPosts[db.currentUser] || [];
                const list = db.savedPosts[db.currentUser];
                const idx = list.indexOf(postId);
                if (idx > -1) {
                    list.splice(idx, 1);
                } else {
                    list.push(postId);
                }
                saveLocalDB(db);
                return { saved: idx === -1 };
            }
        }
    }

    const followMatch = pathname.match(/^\/api\/users\/([a-z0-9_]{3,20})\/follow$/);
    if (followMatch && method === "POST") {
        const target = followMatch[1];
        const me = db.users.find(u => u.username === db.currentUser);
        const other = db.users.find(u => u.username === target);
        if (me && other) {
            me.following = me.following || [];
            other.followers = other.followers || [];
            const idx = me.following.indexOf(target);
            if (idx > -1) {
                me.following.splice(idx, 1);
                other.followers = other.followers.filter(u => u !== db.currentUser);
            } else {
                me.following.push(target);
                other.followers.push(db.currentUser);
                db.notifications = db.notifications || [];
                db.notifications.push({
                    to: target,
                    from: db.currentUser,
                    text: "started following you 👥",
                    date: new Date().toISOString(),
                    read: false
                });
            }
            saveLocalDB(db);
            return { following: idx === -1 };
        }
    }

    if (pathname === "/api/profile" && method === "PATCH") {
        const me = db.users.find(u => u.username === db.currentUser);
        if (me) {
            if (body.name) me.name = body.name.trim();
            if (body.bio !== undefined) me.bio = body.bio.trim();
            if (body.avatar !== undefined) me.avatar = body.avatar.trim();
            if (body.cover !== undefined) me.cover = body.cover.trim();
            saveLocalDB(db);
            return { user: me };
        }
    }

    if (pathname === "/api/notifications/read" && method === "POST") {
        (db.notifications || []).forEach(n => {
            if (n.to === db.currentUser) n.read = true;
        });
        saveLocalDB(db);
        return { ok: true };
    }

    // Admin endpoints in local mode
    if (pathname === "/api/admin/stats" && method === "GET") {
        const totalUsers = db.users.length;
        const totalAdmins = db.users.filter(u => u.isAdmin).length;
        const totalPosts = db.posts.length;
        const postsWithImages = db.posts.filter(p => Boolean(p.image)).length;
        let totalComments = 0;
        let totalLikes = 0;
        db.posts.forEach(p => {
            totalComments += (p.comments || []).length;
            totalLikes += (p.likes || []).length;
        });
        let totalFollows = 0;
        db.users.forEach(u => {
            totalFollows += (u.following || []).length;
        });

        return {
            stats: {
                totalUsers,
                totalAdmins,
                totalPosts,
                postsWithImages,
                totalComments,
                totalLikes,
                totalFollows,
                uptimeSeconds: 120,
                nodeVersion: "Browser Standalone Mode",
                dbSizeBytes: JSON.stringify(db).length
            }
        };
    }

    if (pathname === "/api/admin/users" && method === "GET") {
        const allUsers = db.users.map(u => ({
            ...u,
            postCount: db.posts.filter(p => p.username === u.username).length,
            followerCount: (u.followers || []).length,
            followingCount: (u.following || []).length,
            commentCount: db.posts.reduce((acc, p) => acc + (p.comments || []).filter(c => c.username === u.username).length, 0)
        }));
        return { users: allUsers };
    }

    const adminRoleMatch = pathname.match(/^\/api\/admin\/users\/([a-z0-9_]{3,20})\/role$/);
    if (adminRoleMatch && method === "PATCH") {
        const target = adminRoleMatch[1];
        const targetUser = db.users.find(u => u.username === target);
        if (targetUser) {
            targetUser.isAdmin = Boolean(body.isAdmin);
            saveLocalDB(db);
            return { ok: true, isAdmin: targetUser.isAdmin };
        }
    }

    const adminResetMatch = pathname.match(/^\/api\/admin\/users\/([a-z0-9_]{3,20})\/reset-password$/);
    if (adminResetMatch && method === "POST") {
        const target = adminResetMatch[1];
        const targetUser = db.users.find(u => u.username === target);
        if (targetUser) {
            targetUser.password = body.newPassword || "1234";
            saveLocalDB(db);
            return { ok: true };
        }
    }

    const adminDeleteUserMatch = pathname.match(/^\/api\/admin\/users\/([a-z0-9_]{3,20})$/);
    if (adminDeleteUserMatch && method === "DELETE") {
        const target = adminDeleteUserMatch[1];
        db.users = db.users.filter(u => u.username !== target);
        db.posts = db.posts.filter(p => p.username !== target);
        saveLocalDB(db);
        return { ok: true };
    }

    const adminBanMatch = pathname.match(/^\/api\/admin\/users\/([a-z0-9_]{3,20})\/ban$/);
    if (adminBanMatch && method === "PATCH") {
        const target = adminBanMatch[1];
        const targetUser = db.users.find(u => u.username === target);
        if (targetUser) {
            targetUser.isBanned = Boolean(body.isBanned);
            db.logs = db.logs || [];
            db.logs.unshift({
                id: Date.now(),
                admin_username: db.currentUser,
                action: targetUser.isBanned ? "Suspended User" : "Reactivated User",
                target: `@${target}`,
                created_at: new Date().toISOString()
            });
            saveLocalDB(db);
            return { ok: true, isBanned: targetUser.isBanned };
        }
    }

    if (pathname === "/api/admin/logs" && method === "GET") {
        return { logs: db.logs || [] };
    }

    if (pathname === "/api/admin/posts" && method === "GET") {
        const allPosts = db.posts.map(p => ({
            id: p.id,
            username: p.username,
            text: p.text,
            image: p.image,
            createdAt: p.createdAt,
            likesCount: (p.likes || []).length,
            commentsCount: (p.comments || []).length
        }));
        return { posts: allPosts };
    }

    if (pathname === "/api/admin/comments" && method === "GET") {
        const allComments = [];
        db.posts.forEach(p => {
            (p.comments || []).forEach(c => {
                allComments.push({
                    id: c.id,
                    postId: p.id,
                    username: c.username,
                    text: c.text,
                    date: c.date,
                    postAuthor: p.username
                });
            });
        });
        return { comments: allComments };
    }

    if (pathname === "/api/admin/broadcast" && method === "POST") {
        const message = (body.message || "").trim();
        const asPost = Boolean(body.asPost);
        const now = new Date().toISOString();
        db.notifications = db.notifications || [];
        db.users.forEach(u => {
            db.notifications.push({
                to: u.username,
                from: db.currentUser,
                text: `📢 ANNOUNCEMENT: ${message}`,
                date: now,
                read: false
            });
        });
        if (asPost) {
            db.posts.unshift({
                id: Date.now(),
                username: db.currentUser,
                text: `📢 [COMMUNITY ANNOUNCEMENT]\n\n${message}`,
                image: "",
                createdAt: now,
                likes: [],
                comments: []
            });
        }
        saveLocalDB(db);
        return { ok: true, recipientsCount: db.users.length };
    }

    return { ok: true };
}

/* =====================================
   API AND DATA LOADING
===================================== */

async function apiRequest(path, options = {}) {
    if (!isLocalFallback) {
        try {
            const response = await fetch(path, {
                ...options,
                headers: {
                    ...(options.body ? { "Content-Type": "application/json" } : {}),
                    ...options.headers
                }
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "The request could not be completed.");
            return data;
        } catch (error) {
            if (error instanceof TypeError || error.name === "TypeError" || String(error).includes("Failed to fetch") || String(error).includes("NetworkError")) {
                console.warn("Server unavailable, activating standalone mode...", error);
                isLocalFallback = true;
            } else {
                throw error;
            }
        }
    }

    // Standalone fallback
    return handleLocalApiRequest(path, options);
}

async function loadAppData() {
    const data = await apiRequest("/api/bootstrap");
    users = data.users || [];
    posts = data.posts || [];
    notifications = data.notifications || [];
    savedPosts = data.savedPosts || [];
    currentUser = data.currentUser || null;
}

async function refreshAppData() {
    await loadAppData();
    updateNavbar();
    updateStats();
    renderSuggestions();
    renderTrendingTopics();
    updateNotificationBadge();

    const profilePage = document.getElementById("profilePage");
    if (profilePage && profilePage.style.display === "block") {
        renderProfile();
    }

    const homePage = document.getElementById("homePage");
    if (homePage && homePage.style.display !== "none") {
        renderFeed();
    }

    const notifPage = document.getElementById("notificationsPage");
    if (notifPage && notifPage.style.display === "block") {
        renderNotifications();
    }

    const adminPage = document.getElementById("adminPage");
    if (adminPage && adminPage.style.display === "block") {
        await loadAdminData();
    }
}

function getSavedForCurrentUser() {
    return savedPosts;
}

/* =====================================
   AUTH
===================================== */

function showRegister() {
    document.getElementById("loginForm").style.display = "none";
    document.getElementById("registerForm").style.display = "block";
}

function showLogin() {
    document.getElementById("registerForm").style.display = "none";
    document.getElementById("loginForm").style.display = "block";
}

async function register() {
    const name = document.getElementById("registerName").value.trim();
    const username = document.getElementById("registerUsername").value.trim().toLowerCase();
    const password = document.getElementById("registerPassword").value;

    if (!name || !username || password.length < 4) {
        showToast("Enter your name, a username, and a password of at least 4 characters.");
        return;
    }

    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
        showToast("Username must be 3–20 characters: letters, numbers, or underscores.");
        return;
    }

    try {
        const data = await apiRequest("/api/auth/register", {
            method: "POST",
            body: JSON.stringify({ name, username, password })
        });
        users.push(data.user);
        document.getElementById("registerPassword").value = "";
        document.getElementById("loginUsername").value = username;
        showToast("Account created successfully!");
        showLogin();
    } catch (error) {
        showToast(error.message);
    }
}

async function login() {
    const username = document.getElementById("loginUsername").value.trim().toLowerCase();
    const password = document.getElementById("loginPassword").value;

    if (!username || !password) {
        showToast("Please enter your username and password.");
        return;
    }

    try {
        await apiRequest("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ username, password })
        });
        document.getElementById("loginPassword").value = "";
        await loadAppData();
        startApp();
        showToast(`Welcome back, @${username}! 👋`);
    } catch (error) {
        showToast(error.message);
    }
}

async function logout() {
    try {
        await apiRequest("/api/auth/session", { method: "DELETE" });
    } catch (error) {
        showToast(error.message);
        return;
    }
    currentUser = null;
    users = [];
    posts = [];
    notifications = [];
    savedPosts = [];
    viewingProfileUsername = null;
    document.getElementById("app").style.display = "none";
    document.getElementById("authPage").style.display = "flex";
    showToast("Logged out successfully.");
}

/* =====================================
   CURRENT USER
===================================== */

function getCurrentUser() {
    return users.find(u => u.username === currentUser);
}

/* =====================================
   APP INITIALIZATION
===================================== */

function startApp() {
    if (!currentUser) return;

    document.getElementById("authPage").style.display = "none";
    document.getElementById("app").style.display = "block";

    updateNavbar();
    updateStats();
    renderSuggestions();
    renderProfile();
    renderTrendingTopics();
    updateNotificationBadge();
    showHome();
    syncFilterButtons();
}

function updateNavbar() {
    const user = getCurrentUser();
    if (!user) return;

    document.getElementById("navUsername").textContent = "@" + user.username;
    const letter = user.name.charAt(0).toUpperCase();
    const avatarEl = document.getElementById("navAvatar");
    const createAvatar = document.getElementById("createAvatar");

    avatarEl.textContent = letter;
    createAvatar.textContent = letter;

    if (user.avatar) {
        avatarEl.innerHTML = `<img src="${escapeAttribute(user.avatar)}" alt="avatar" class="user-avatar-image">`;
        createAvatar.innerHTML = `<img src="${escapeAttribute(user.avatar)}" alt="avatar" class="user-avatar-image">`;
    }

    // Toggle Admin Navigation visibility
    const navAdminBtn = document.getElementById("navAdminBtn");
    if (navAdminBtn) {
        navAdminBtn.style.display = user.isAdmin ? "inline-flex" : "none";
    }
    const sideAdminBtn = document.getElementById("sideAdminBtn");
    if (sideAdminBtn) {
        sideAdminBtn.style.display = user.isAdmin ? "block" : "none";
    }
}

/* =====================================
   FILTERS & STORIES
===================================== */

function setFilter(mode) {
    activeFilter = mode;
    localStorage.setItem("siddverse_filter", mode);
    syncFilterButtons();
    renderFeed();
}

function syncFilterButtons() {
    document.querySelectorAll(".filter-btn").forEach(button => {
        const isActive = button.dataset.filter === activeFilter;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
    });
}

function filterByStory(category, element) {
    activeStoryCategory = category;
    document.querySelectorAll(".story-strip .story-card").forEach(c => c.classList.remove("active"));
    if (element) {
        element.classList.add("active");
    }

    // Switch to home view
    const homePage = document.getElementById("homePage");
    if (homePage.style.display === "none") {
        showHome();
    }

    renderFeed();
}

function getFilteredPosts() {
    const me = getCurrentUser();
    const following = me ? (me.following || []) : [];
    const saved = getSavedForCurrentUser();

    let filtered = [...posts];

    // Story Strip Filter
    if (activeStoryCategory === "photo") {
        filtered = filtered.filter(p => Boolean(p.image && p.image.trim()));
    } else if (activeStoryCategory === "tech") {
        filtered = filtered.filter(p => {
            const txt = (p.text + " " + p.username).toLowerCase();
            return ["tech", "coding", "code", "dev", "software", "ai", "ui", "build", "app"].some(term => txt.includes(term));
        });
    } else if (activeStoryCategory === "campus") {
        filtered = filtered.filter(p => {
            const txt = (p.text + " " + p.username).toLowerCase();
            return ["campus", "college", "student", "class", "study", "project", "event", "idea"].some(term => txt.includes(term));
        });
    }

    // Tab Toolbar Filter
    if (activeFilter === "following") {
        filtered = filtered.filter(post => post.username === currentUser || following.includes(post.username));
    } else if (activeFilter === "trending") {
        filtered = filtered.filter(post => post.likes.length >= 1 || post.comments.length >= 1).sort((a, b) => {
            const scoreA = a.likes.length + a.comments.length * 2;
            const scoreB = b.likes.length + b.comments.length * 2;
            return scoreB - scoreA;
        });
        return filtered;
    } else if (activeFilter === "saved") {
        filtered = filtered.filter(post => saved.includes(post.id));
    }

    return filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/* =====================================
   CREATE POST & MEDIA HANDLERS
===================================== */

let createImageBase64 = "";
let editPostImageBase64 = "";
let isPollCreatorOpen = false;
let editPostTargetId = null;

function handlePostFileSelect(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
        showToast("Please select a valid image file.");
        return;
    }
    const reader = new FileReader();
    reader.onload = e => {
        createImageBase64 = e.target.result;
        const previewWrap = document.getElementById("createImagePreviewWrap");
        const previewImg = document.getElementById("createImagePreview");
        if (previewWrap && previewImg) {
            previewImg.src = createImageBase64;
            previewWrap.style.display = "flex";
        }
    };
    reader.readAsDataURL(file);
}

function clearCreateImage() {
    createImageBase64 = "";
    const previewWrap = document.getElementById("createImagePreviewWrap");
    if (previewWrap) previewWrap.style.display = "none";
    const fileInput = document.getElementById("postFileInput");
    if (fileInput) fileInput.value = "";
}

function togglePollCreator(forceState) {
    const pollCard = document.getElementById("pollCreatorCard");
    const toggleBtn = document.getElementById("togglePollBtn");
    isPollCreatorOpen = forceState !== undefined ? forceState : !isPollCreatorOpen;
    if (pollCard) {
        pollCard.style.display = isPollCreatorOpen ? "block" : "none";
    }
    if (toggleBtn) {
        toggleBtn.classList.toggle("active", isPollCreatorOpen);
    }
    if (!isPollCreatorOpen) {
        const q = document.getElementById("pollQuestionInput");
        if (q) q.value = "";
        for (let i = 1; i <= 4; i++) {
            const opt = document.getElementById(`pollOpt${i}`);
            if (opt) opt.value = "";
        }
    }
}

async function createPost() {
    const text = document.getElementById("postText").value.trim();
    const urlImage = document.getElementById("imageURL").value.trim();
    const image = createImageBase64 || urlImage;

    let pollQuestion = "";
    let pollOptions = [];
    if (isPollCreatorOpen) {
        pollQuestion = document.getElementById("pollQuestionInput").value.trim();
        const o1 = document.getElementById("pollOpt1").value.trim();
        const o2 = document.getElementById("pollOpt2").value.trim();
        const o3 = document.getElementById("pollOpt3").value.trim();
        const o4 = document.getElementById("pollOpt4").value.trim();
        pollOptions = [o1, o2, o3, o4].filter(Boolean);

        if (pollQuestion && pollOptions.length < 2) {
            showToast("A poll requires at least 2 options!");
            return;
        }
    }

    if (!text && !image && !pollQuestion) {
        showToast("Write something, attach a photo, or create a poll!");
        return;
    }

    try {
        await apiRequest("/api/posts", {
            method: "POST",
            body: JSON.stringify({
                text,
                image,
                pollQuestion,
                pollOptions
            })
        });
        document.getElementById("postText").value = "";
        document.getElementById("imageURL").value = "";
        clearCreateImage();
        togglePollCreator(false);
        await refreshAppData();
        showToast("Post published 🚀");
    } catch (error) {
        showToast(error.message);
    }
}

/* =====================================
   FEED RENDERING & POST ELEMENTS
===================================== */

function renderFeed(list = getFilteredPosts()) {
    const feed = document.getElementById("feed");
    if (!feed) return;
    feed.innerHTML = "";

    if (list.length === 0) {
        const query = document.getElementById("searchInput").value.trim();
        let heading = "No posts yet";
        let message = "Be the first to share something with your community.";

        if (query) {
            heading = `No results for "${query}"`;
            message = "Try another search term or click Clear.";
        } else if (activeStoryCategory !== "all") {
            heading = `No ${activeStoryCategory} posts found`;
            message = "Click 'Stories' above to view all community posts.";
        } else if (activeFilter === "saved") {
            heading = "No saved posts yet";
            message = "Save a post and it will appear here.";
        } else if (activeFilter === "following") {
            heading = "No posts from your circle yet";
            message = "Follow people or share a post to fill your feed.";
        } else if (activeFilter === "trending") {
            heading = "Nothing trending yet";
            message = "Posts with likes and comments will show up here.";
        }

        feed.innerHTML = `
            <div class="post-card empty-state">
                <h3>${escapeHTML(heading)}</h3>
                <p>${escapeHTML(message)}</p>
            </div>
        `;
        return;
    }

    list.forEach(post => feed.appendChild(createPostElement(post)));
}

function formatPostText(rawText) {
    const escaped = escapeHTML(rawText);
    return escaped.replace(/#([a-zA-Z0-9_]+)/g, (match, tag) => {
        return `<span class="hashtag-pill" onclick="event.stopPropagation(); searchTopic('${tag}')">#${tag}</span>`;
    });
}

function createPostElement(post) {
    const user = users.find(u => u.username === post.username);
    const me = getCurrentUser();
    const div = document.createElement("div");
    div.className = "post-card";

    const liked = (post.likes || []).includes(currentUser);
    const isOwner = post.username === currentUser;
    const canDelete = isOwner || Boolean(me && me.isAdmin);
    const canEdit = isOwner;
    const saved = getSavedForCurrentUser().includes(post.id);
    const userInitial = user ? user.name.charAt(0).toUpperCase() : "U";
    const profileImage = user && user.avatar 
        ? `<img src="${escapeAttribute(user.avatar)}" alt="" class="user-avatar-image">` 
        : `<div class="avatar" aria-hidden="true">${userInitial}</div>`;

    const commentsHTML = (post.comments || []).map(c => {
        const canDeleteComment = me && (c.username === currentUser || post.username === currentUser || me.isAdmin);
        return `
            <div class="comment-item" id="comment-item-${c.id}">
                <div class="comment-content">
                    <strong class="comment-author user-clickable" onclick="viewUserProfile('${escapeAttribute(c.username)}')">@${escapeHTML(c.username)}</strong>
                    <span class="comment-text">${escapeHTML(c.text)}</span>
                </div>
                ${canDeleteComment ? `<button class="delete-comment-btn" type="button" title="Delete comment" onclick="deleteComment(${post.id}, ${c.id})">&times;</button>` : ""}
            </div>
        `;
    }).join("");

    const createdAt = new Date(post.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

    // Poll rendering
    let pollHtml = "";
    if (post.poll && post.poll.options && post.poll.options.length > 0) {
        const totalVotes = post.poll.totalVotes || 0;
        const optionsHtml = post.poll.options.map((opt, idx) => {
            const votes = opt.votes || 0;
            const percent = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
            const isChosen = post.poll.userVote === idx;
            return `
                <div class="poll-option-row ${isChosen ? 'chosen' : ''}" onclick="votePoll(${post.id}, ${idx})" role="button" tabindex="0">
                    <div class="poll-option-fill" style="width: ${percent}%;"></div>
                    <div class="poll-option-content">
                        <span class="poll-option-label">${isChosen ? '✓ ' : ''}${escapeHTML(opt.text)}</span>
                        <span class="poll-option-stat">${percent}% (${votes})</span>
                    </div>
                </div>
            `;
        }).join("");

        pollHtml = `
            <div class="poll-box">
                <div class="poll-box-title">📊 ${escapeHTML(post.poll.question)}</div>
                <div class="poll-options-list">${optionsHtml}</div>
                <div class="poll-footer-meta">
                    ${totalVotes} vote${totalVotes === 1 ? '' : 's'}
                    ${post.poll.userVote !== null && post.poll.userVote !== undefined ? ' • <span class="voted-text">You voted</span>' : ' • <span>Click an option to vote</span>'}
                </div>
            </div>
        `;
    }

    div.innerHTML = `
        <div class="post-header">
            <div class="user-info user-clickable" onclick="viewUserProfile('${escapeAttribute(post.username)}')">
                ${profileImage}
                <div>
                    <div class="user-name">
                        ${user ? escapeHTML(user.name) : escapeHTML(post.username)}
                        ${user && user.isAdmin ? '<span class="inline-admin-tag">Admin</span>' : ''}
                    </div>
                    <div class="username">@${escapeHTML(post.username)}</div>
                </div>
            </div>
            <div class="post-header-actions">
                ${canEdit ? `<button class="post-menu edit-post-btn" type="button" aria-label="Edit post" title="Edit post" onclick="openEditPost(${post.id})">✏️</button>` : ""}
                ${canDelete ? `<button class="post-menu" type="button" aria-label="Delete post" title="Delete post" onclick="deletePost(${post.id})">🗑️</button>` : ""}
            </div>
        </div>

        <div class="post-meta">${createdAt} ${post.isEdited ? '<span class="edited-tag">• (edited)</span>' : ''}</div>

        ${post.text ? `<div class="post-text">${formatPostText(post.text)}</div>` : ""}
        ${pollHtml}
        ${post.image ? `<img class="post-image" src="${escapeAttribute(post.image)}" alt="Image attached to post">` : ""}

        <div class="post-actions">
            <button class="action-btn ${liked ? "liked" : ""}" type="button" aria-label="${liked ? "Unlike" : "Like"} post" aria-pressed="${liked}" onclick="toggleLike(${post.id})">${liked ? "❤️" : "🤍"} ${(post.likes || []).length}</button>
            <button class="action-btn" type="button" aria-label="Write a comment" onclick="focusComment(${post.id})">💬 ${(post.comments || []).length}</button>
            <button class="action-btn" type="button" onclick="sharePost(${post.id})">🔗 Share</button>
            <button class="action-btn" type="button" aria-pressed="${saved}" onclick="toggleSave(${post.id})">${saved ? "🔖 Saved" : "📌 Save"}</button>
        </div>

        <div class="comments">
            <div class="comments-list">${commentsHTML}</div>
            <input class="comment-input" id="comment-${post.id}" aria-label="Write a comment" placeholder="Write a comment and press Enter..." onkeydown="commentEnter(event, ${post.id})">
        </div>
    `;

    const postImage = div.querySelector(".post-image");
    if (postImage) {
        postImage.addEventListener("error", () => {
            const fallback = document.createElement("p");
            fallback.className = "image-fallback";
            fallback.textContent = "This image could not be loaded.";
            postImage.replaceWith(fallback);
        }, { once: true });
    }

    return div;
}

/* =====================================
   POLL VOTING & POST EDITING
===================================== */

async function votePoll(postId, optionIndex) {
    if (!currentUser) {
        showToast("Please log in to vote.");
        return;
    }
    try {
        await apiRequest(`/api/posts/${postId}/vote`, {
            method: "POST",
            body: JSON.stringify({ optionIndex })
        });
        await refreshAppData();
        showToast("Vote recorded! 📊");
    } catch (error) {
        showToast(error.message);
    }
}

function openEditPost(postId) {
    const post = posts.find(p => p.id === postId);
    if (!post) return;
    editPostTargetId = postId;
    document.getElementById("editPostId").value = postId;
    document.getElementById("editPostText").value = post.text || "";
    document.getElementById("editPostImage").value = post.image || "";
    editPostImageBase64 = "";

    const previewWrap = document.getElementById("editPostPreviewWrap");
    const previewImg = document.getElementById("editPostPreview");
    if (post.image) {
        previewImg.src = post.image;
        previewWrap.style.display = "flex";
    } else {
        previewWrap.style.display = "none";
    }

    const modal = document.getElementById("editPostModal");
    if (modal) modal.style.display = "flex";
}

function closeEditPostModal() {
    const modal = document.getElementById("editPostModal");
    if (modal) modal.style.display = "none";
    editPostTargetId = null;
    editPostImageBase64 = "";
    clearEditPostPreview();
}

function handleEditPostFileSelect(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        editPostImageBase64 = e.target.result;
        document.getElementById("editPostImage").value = "";
        const previewWrap = document.getElementById("editPostPreviewWrap");
        const previewImg = document.getElementById("editPostPreview");
        if (previewWrap && previewImg) {
            previewImg.src = editPostImageBase64;
            previewWrap.style.display = "flex";
        }
    };
    reader.readAsDataURL(file);
}

function clearEditPostPreview() {
    editPostImageBase64 = "";
    document.getElementById("editPostImage").value = "";
    const previewWrap = document.getElementById("editPostPreviewWrap");
    if (previewWrap) previewWrap.style.display = "none";
    const fileInput = document.getElementById("editPostFileInput");
    if (fileInput) fileInput.value = "";
}

async function saveEditPost() {
    if (!editPostTargetId) return;
    const text = document.getElementById("editPostText").value.trim();
    const urlImage = document.getElementById("editPostImage").value.trim();
    const image = editPostImageBase64 || urlImage;

    if (!text && !image) {
        showToast("Post cannot be completely empty.");
        return;
    }

    try {
        await apiRequest(`/api/posts/${editPostTargetId}`, {
            method: "PATCH",
            body: JSON.stringify({ text, image })
        });
        closeEditPostModal();
        await refreshAppData();
        showToast("Post updated successfully! ✏️");
    } catch (error) {
        showToast(error.message);
    }
}

function handleProfileFileSelect(event, targetInputId) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        const input = document.getElementById(targetInputId);
        if (input) input.value = e.target.result;
    };
    reader.readAsDataURL(file);
}

function showSavedPage() {
    showHome();
    setFilter("saved");
    document.querySelectorAll(".sidebar .side-item").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.page === "saved");
    });
}

/* =====================================
   LIKE / SAVE / COMMENT
===================================== */

async function toggleLike(postId) {
    try {
        await apiRequest(`/api/posts/${postId}/like`, { method: "POST" });
        await refreshAppData();
    } catch (error) {
        showToast(error.message);
    }
}

async function toggleSave(postId) {
    if (!currentUser) return;

    try {
        const result = await apiRequest(`/api/posts/${postId}/save`, { method: "POST" });
        await refreshAppData();
        showToast(result.saved ? "Post saved successfully." : "Post removed from saved items.");
    } catch (error) {
        showToast(error.message);
    }
}

function commentEnter(event, postId) {
    if (event.key === "Enter") {
        addComment(postId);
    }
}

function focusComment(postId) {
    const input = document.getElementById("comment-" + postId);
    if (input) input.focus();
}

async function addComment(postId) {
    const input = document.getElementById("comment-" + postId);
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;

    const post = posts.find(p => p.id === postId);
    if (!post) return;

    try {
        await apiRequest(`/api/posts/${postId}/comments`, {
            method: "POST",
            body: JSON.stringify({ text })
        });
        input.value = "";
        await refreshAppData();
        showToast("Comment posted!");
    } catch (error) {
        showToast(error.message);
    }
}

async function deleteComment(postId, commentId) {
    if (!confirm("Are you sure you want to delete this comment?")) return;

    try {
        await apiRequest(`/api/comments/${commentId}`, { method: "DELETE" });
        await refreshAppData();
        showToast("Comment deleted.");
    } catch (error) {
        showToast(error.message);
    }
}

/* =====================================
   DELETE / SHARE / FOLLOW / SUGGESTIONS
===================================== */

async function deletePost(postId) {
    const post = posts.find(p => p.id === postId);
    if (!post) return;

    const me = getCurrentUser();
    if (post.username !== currentUser && (!me || !me.isAdmin)) {
        showToast("You can delete only your own posts.");
        return;
    }

    if (!confirm("Are you sure you want to delete this post?")) return;

    try {
        await apiRequest(`/api/posts/${postId}`, { method: "DELETE" });
        await refreshAppData();
        showToast("Post deleted.");
    } catch (error) {
        showToast(error.message);
    }
}

function sharePost(postId) {
    const post = posts.find(p => p.id === postId);
    if (!post) return;

    const shareText = `Check this post on SiddVerse by @${post.username}: ${post.text || "A fresh update from the community"}`;

    if (navigator.share) {
        navigator.share({ title: "SiddVerse", text: shareText }).catch(error => {
            if (error.name !== "AbortError") showToast("Unable to share this post.");
        });
    } else {
        if (!navigator.clipboard) {
            showToast("Sharing is not available in this browser.");
            return;
        }
        navigator.clipboard.writeText(shareText)
            .then(() => showToast("Post text copied to clipboard!"))
            .catch(() => showToast("Unable to copy the post text."));
    }
}

async function toggleFollow(username) {
    if (username === currentUser) return;

    try {
        const result = await apiRequest(`/api/users/${encodeURIComponent(username)}/follow`, { method: "POST" });
        await refreshAppData();
        showToast(result.following ? `You are now following @${username}` : `Unfollowed @${username}`);
    } catch (error) {
        showToast(error.message);
    }
}

function renderSuggestions() {
    const container = document.getElementById("suggestions");
    if (!container) return;

    const me = getCurrentUser();
    if (!me) return;

    container.innerHTML = "";

    users.filter(u => u.username !== currentUser).slice(0, 5).forEach(user => {
        const following = me.following ? me.following.includes(user.username) : false;
        const div = document.createElement("div");
        div.className = "user-suggestion";

        div.innerHTML = `
            <div class="user-info user-clickable" onclick="viewUserProfile('${escapeAttribute(user.username)}')">
                <div class="avatar" aria-hidden="true">${escapeHTML(user.name.charAt(0).toUpperCase())}</div>
                <div>
                    <strong>${escapeHTML(user.name)}</strong>
                    <div class="username">@${escapeHTML(user.username)}</div>
                </div>
            </div>
            <button class="follow-btn ${following ? "following" : ""}" type="button">${following ? "Following" : "Follow"}</button>
        `;

        div.querySelector(".follow-btn").addEventListener("click", () => toggleFollow(user.username));
        container.appendChild(div);
    });
}

/* =====================================
   PROFILES
===================================== */

function viewUserProfile(username) {
    if (!username) return;
    showProfile(username);
}

function showProfile(username) {
    viewingProfileUsername = username || currentUser;
    setActiveNavigation("profile");
    document.getElementById("homePage").style.display = "none";
    document.getElementById("notificationsPage").style.display = "none";
    document.getElementById("adminPage").style.display = "none";
    document.getElementById("profilePage").style.display = "block";
    renderProfile();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function showHome() {
    viewingProfileUsername = null;
    setActiveNavigation("home");
    document.getElementById("profilePage").style.display = "none";
    document.getElementById("notificationsPage").style.display = "none";
    document.getElementById("adminPage").style.display = "none";
    document.getElementById("homePage").style.display = "block";
    renderFeed();
}

function showNotifications() {
    setActiveNavigation("notifications");
    document.getElementById("homePage").style.display = "none";
    document.getElementById("profilePage").style.display = "none";
    document.getElementById("adminPage").style.display = "none";
    document.getElementById("notificationsPage").style.display = "block";
    renderNotifications();
}

function setActiveNavigation(page) {
    document.querySelectorAll(".side-item[data-page]").forEach(item => {
        const active = item.dataset.page === page;
        item.classList.toggle("active", active);
        if (active) {
            item.setAttribute("aria-current", "page");
        } else {
            item.removeAttribute("aria-current");
        }
    });
}

function renderProfile() {
    const targetUsername = viewingProfileUsername || currentUser;
    const targetUser = users.find(u => u.username === targetUsername);
    if (!targetUser) {
        showToast("User @" + targetUsername + " not found.");
        showHome();
        return;
    }

    const me = getCurrentUser();
    const isMe = targetUser.username === currentUser;

    document.getElementById("profileName").textContent = targetUser.name;
    document.getElementById("profileUsername").textContent = "@" + targetUser.username;
    document.getElementById("profileBio").textContent = targetUser.bio || "No bio yet.";

    const avatarLetter = targetUser.name.charAt(0).toUpperCase();
    const avatarEl = document.getElementById("profileAvatar");
    if (targetUser.avatar) {
        avatarEl.innerHTML = `<img src="${escapeAttribute(targetUser.avatar)}" alt="" class="profile-avatar-img">`;
    } else {
        avatarEl.textContent = avatarLetter;
    }

    document.getElementById("profileCover").style.background = targetUser.cover 
        ? `url("${escapeAttribute(targetUser.cover)}") center/cover no-repeat` 
        : "linear-gradient(120deg,#7c3aed,#ec4899,#06b6d4)";

    const adminBadge = document.getElementById("profileAdminBadge");
    if (adminBadge) {
        adminBadge.style.display = targetUser.isAdmin ? "inline-block" : "none";
    }

    const targetPosts = posts.filter(p => p.username === targetUser.username);
    document.getElementById("postCount").textContent = targetPosts.length;
    document.getElementById("followerCount").textContent = targetUser.followers ? targetUser.followers.length : 0;
    document.getElementById("followingCount").textContent = targetUser.following ? targetUser.following.length : 0;

    const editBtn = document.getElementById("profileEditBtn");
    const followBtn = document.getElementById("profileFollowBtn");
    const backBtn = document.getElementById("profileBackBtn");

    if (isMe) {
        editBtn.style.display = "inline-block";
        followBtn.style.display = "none";
        backBtn.style.display = "none";
    } else {
        editBtn.style.display = "none";
        followBtn.style.display = "inline-block";
        backBtn.style.display = "inline-block";
        const isFollowing = me && me.following && me.following.includes(targetUser.username);
        followBtn.textContent = isFollowing ? "Following" : "Follow";
        followBtn.classList.toggle("following", Boolean(isFollowing));
    }

    document.getElementById("profilePostsHeading").textContent = isMe ? "Your Posts" : `${targetUser.name}'s Posts`;

    const profilePosts = document.getElementById("profilePosts");
    profilePosts.innerHTML = "";
    if (targetPosts.length === 0) {
        profilePosts.innerHTML = `
            <div class="post-card empty-state">
                <h3>No posts yet</h3>
                <p>${isMe ? "Share your first update and start your story." : `@${escapeHTML(targetUser.username)} hasn't shared any posts yet.`}</p>
            </div>
        `;
        return;
    }

    targetPosts.forEach(post => profilePosts.appendChild(createPostElement(post)));
}

async function toggleFollowProfileUser() {
    if (!viewingProfileUsername || viewingProfileUsername === currentUser) return;
    await toggleFollow(viewingProfileUsername);
    renderProfile();
}

function openEditProfile() {
    const user = getCurrentUser();
    document.getElementById("editName").value = user.name;
    document.getElementById("editBio").value = user.bio;
    document.getElementById("editAvatar").value = user.avatar || "";
    document.getElementById("editCover").value = user.cover || "";
    document.getElementById("editModal").style.display = "flex";
}

function closeEditProfile() {
    document.getElementById("editModal").style.display = "none";
}

async function saveProfile() {
    const user = getCurrentUser();
    const profile = {
        name: document.getElementById("editName").value.trim() || user.name,
        bio: document.getElementById("editBio").value.trim(),
        avatar: document.getElementById("editAvatar").value.trim(),
        cover: document.getElementById("editCover").value.trim()
    };

    try {
        await apiRequest("/api/profile", {
            method: "PATCH",
            body: JSON.stringify(profile)
        });
        closeEditProfile();
        await refreshAppData();
        showToast("Profile updated successfully!");
    } catch (error) {
        showToast(error.message);
    }
}

/* =====================================
   SEARCH + NOTIFICATIONS + TRENDING
===================================== */

function searchContent() {
    const query = document.getElementById("searchInput").value.trim().toLowerCase();

    // Switch to home view if currently on another page
    const homePage = document.getElementById("homePage");
    if (homePage && homePage.style.display === "none") {
        showHome();
    }

    if (!query) {
        renderFeed();
        return;
    }

    const cleanQuery = query.startsWith("#") ? query.slice(1) : query;

    const results = posts.filter(post => {
        const user = users.find(u => u.username === post.username);
        const textMatch = post.text.toLowerCase().includes(cleanQuery);
        const userMatch = post.username.toLowerCase().includes(cleanQuery);
        const nameMatch = user && user.name.toLowerCase().includes(cleanQuery);
        return textMatch || userMatch || nameMatch;
    });

    renderFeed(results);
}

function searchTopic(topic) {
    const searchInput = document.getElementById("searchInput");
    searchInput.value = "#" + topic;
    searchContent();
}

function renderNotifications() {
    const container = document.getElementById("notificationList");
    const myNotifications = (notifications || [])
        .filter(notification => notification.to === currentUser)
        .reverse();

    container.innerHTML = "";

    if (myNotifications.length === 0) {
        container.innerHTML = `
            <div class="post-card empty-state">
                <h3>You're all caught up</h3>
                <p>When someone interacts with you, you'll see it here.</p>
            </div>
        `;
        return;
    }

    myNotifications.forEach(notification => {
        const sender = users.find(user => user.username === notification.from);
        const item = document.createElement("article");
        item.className = `notification-item${notification.read ? "" : " unread"}`;

        const avatar = document.createElement("div");
        avatar.className = "avatar user-clickable";
        avatar.setAttribute("aria-hidden", "true");
        avatar.textContent = sender ? sender.name.charAt(0).toUpperCase() : "U";
        avatar.onclick = () => viewUserProfile(notification.from);

        const content = document.createElement("div");
        content.className = "notification-content";

        const message = document.createElement("p");
        const username = document.createElement("strong");
        username.className = "user-clickable";
        username.textContent = "@" + notification.from;
        username.onclick = () => viewUserProfile(notification.from);

        message.append(username, document.createTextNode(" " + notification.text));

        const date = document.createElement("time");
        date.className = "notification-date";
        date.textContent = notification.date && !Number.isNaN(Date.parse(notification.date))
            ? new Date(notification.date).toLocaleString()
            : "";
        if (date.textContent) date.dateTime = notification.date;

        content.append(message, date);
        item.append(avatar, content);
        container.appendChild(item);
    });
}

async function markAllNotificationsRead() {
    try {
        await apiRequest("/api/notifications/read", { method: "POST" });
        await refreshAppData();
        showToast("All notifications marked as read.");
    } catch (error) {
        showToast(error.message);
    }
}

function updateNotificationBadge() {
    const badge = document.getElementById("notificationBadge");
    if (!badge) return;

    const unreadCount = (notifications || []).filter(notification =>
        notification.to === currentUser && !notification.read
    ).length;

    badge.hidden = unreadCount === 0;
    badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    document.querySelector(".notification-button").setAttribute(
        "aria-label",
        unreadCount > 0 ? `Show notifications, ${unreadCount} unread` : "Show notifications"
    );
}

function renderTrendingTopics() {
    const container = document.getElementById("trendingTopics");
    if (!container) return;

    const topics = {};
    posts.forEach(post => {
        const text = post.text.toLowerCase();
        ["technology", "ai", "design", "travel", "coding", "photography", "college", "community", "tech"].forEach(term => {
            if (text.includes(term)) topics[term] = (topics[term] || 0) + 1;
        });
    });

    const items = Object.entries(topics).sort((a, b) => b[1] - a[1]).slice(0, 5);
    container.innerHTML = "";

    if (items.length === 0) {
        container.innerHTML = `<p class="empty-state">Topics will appear as people share posts.</p>`;
        return;
    }

    items.forEach(([label, count]) => {
        const item = document.createElement("div");
        item.className = "trend-item trend-clickable";
        item.setAttribute("title", `Filter feed by #${label}`);
        item.innerHTML = `<span>#${label}</span><small>${count} posts</small>`;
        item.onclick = () => searchTopic(label);
        container.appendChild(item);
    });
}

/* =====================================
   ADMIN DASHBOARD LOGIC
===================================== */

async function showAdminPage() {
    const me = getCurrentUser();
    if (!me || !me.isAdmin) {
        showToast("You do not have administrative access.");
        showHome();
        return;
    }

    setActiveNavigation("admin");
    document.getElementById("homePage").style.display = "none";
    document.getElementById("profilePage").style.display = "none";
    document.getElementById("notificationsPage").style.display = "none";
    document.getElementById("adminPage").style.display = "block";

    await loadAdminData();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

async function loadAdminData(silent = false) {
    try {
        const [statsData, usersData, postsData, commentsData, logsData] = await Promise.all([
            apiRequest("/api/admin/stats"),
            apiRequest("/api/admin/users"),
            apiRequest("/api/admin/posts"),
            apiRequest("/api/admin/comments"),
            apiRequest("/api/admin/logs")
        ]);

        adminData.stats = statsData.stats;
        adminData.users = usersData.users || [];
        adminData.posts = postsData.posts || [];
        adminData.comments = commentsData.comments || [];
        adminData.logs = (logsData && logsData.logs) || [];

        renderAdminStats();
        renderAdminUsersTable();
        renderAdminPostsTable();
        renderAdminCommentsTable();
        renderAdminLogsTable();

        if (silent) {
            showToast("Admin data refreshed! ⚡");
        }
    } catch (error) {
        showToast("Failed to load admin data: " + error.message);
    }
}

function renderAdminStats() {
    const stats = adminData.stats;
    if (!stats) return;

    document.getElementById("adminStatUsers").textContent = stats.totalUsers;
    document.getElementById("adminStatAdmins").textContent = `${stats.totalAdmins} Admin${stats.totalAdmins === 1 ? "" : "s"}`;
    document.getElementById("adminStatPosts").textContent = stats.totalPosts;
    document.getElementById("adminStatPostImages").textContent = `${stats.postsWithImages} with photos`;
    document.getElementById("adminStatComments").textContent = stats.totalComments;
    document.getElementById("adminStatLikes").textContent = `${stats.totalLikes} Likes`;
    document.getElementById("adminStatFollows").textContent = `${stats.totalFollows} Follows`;

    const hours = Math.floor(stats.uptimeSeconds / 3600);
    const mins = Math.floor((stats.uptimeSeconds % 3600) / 60);
    const uptimeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    const kb = (stats.dbSizeBytes / 1024).toFixed(1);
    document.getElementById("adminStatSystem").textContent = `${stats.nodeVersion} • DB: ${kb} KB • Up ${uptimeStr}`;

    document.getElementById("adminTabUsersCount").textContent = stats.totalUsers;
    document.getElementById("adminTabPostsCount").textContent = stats.totalPosts;
    document.getElementById("adminTabCommentsCount").textContent = stats.totalComments;
    const logsCountEl = document.getElementById("adminTabLogsCount");
    if (logsCountEl) logsCountEl.textContent = (adminData.logs || []).length;
}

function switchAdminTab(tabName) {
    activeAdminTab = tabName;
    document.querySelectorAll(".admin-tab-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.admintab === tabName);
    });

    document.getElementById("adminTabPanelUsers").style.display = tabName === "users" ? "block" : "none";
    document.getElementById("adminTabPanelPosts").style.display = tabName === "posts" ? "block" : "none";
    document.getElementById("adminTabPanelComments").style.display = tabName === "comments" ? "block" : "none";
    const logsPanel = document.getElementById("adminTabPanelLogs");
    if (logsPanel) logsPanel.style.display = tabName === "logs" ? "block" : "none";
    document.getElementById("adminTabPanelBroadcast").style.display = tabName === "broadcast" ? "block" : "none";
}

function renderAdminUsersTable(list = adminData.users) {
    const tbody = document.getElementById("adminUsersTableBody");
    tbody.innerHTML = "";

    if (!list || list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No users found.</td></tr>`;
        return;
    }

    list.forEach(u => {
        const isCurrentAdmin = u.username === currentUser;
        const tr = document.createElement("tr");

        const avatarInitial = u.name.charAt(0).toUpperCase();
        const avatarDisplay = u.avatar 
            ? `<img src="${escapeAttribute(u.avatar)}" class="table-avatar-img" alt="">`
            : `<div class="table-avatar-fallback">${avatarInitial}</div>`;

        tr.innerHTML = `
            <td>
                <div class="table-user-cell user-clickable" onclick="viewUserProfile('${escapeAttribute(u.username)}')">
                    ${avatarDisplay}
                    <div>
                        <div class="table-user-name">${escapeHTML(u.name)}</div>
                        <div class="table-user-handle">@${escapeHTML(u.username)}</div>
                    </div>
                </div>
            </td>
            <td>
                <span class="role-badge ${u.isAdmin ? "admin" : "member"}">
                    ${u.isAdmin ? "🛡️ Admin" : "Member"}
                </span>
            </td>
            <td>
                <span class="status-badge ${u.isBanned ? "banned" : "active"}">
                    ${u.isBanned ? "🚫 Suspended" : "✅ Active"}
                </span>
            </td>
            <td>
                <div class="table-stats-cell">
                    <span>${u.postCount} posts</span>
                    <small>${u.followerCount} followers</small>
                </div>
            </td>
            <td>
                <span class="table-bio-cell" title="${escapeAttribute(u.bio || "")}">${escapeHTML(u.bio || "—")}</span>
            </td>
            <td>
                <div class="table-actions-cell">
                    ${!isCurrentAdmin ? `
                        <button class="action-chip ${u.isAdmin ? "warning" : "promote"}" type="button" 
                            title="${u.isAdmin ? "Remove admin rights" : "Promote to Admin"}"
                            onclick="adminToggleRole('${escapeAttribute(u.username)}', ${u.isAdmin})">
                            ${u.isAdmin ? "Demote" : "Promote"}
                        </button>
                    ` : `<span class="you-pill">You</span>`}
                    ${!isCurrentAdmin ? `
                        <button class="action-chip ${u.isBanned ? "success" : "danger"}" type="button" 
                            title="${u.isBanned ? "Reactivate user account" : "Suspend user account"}"
                            onclick="adminToggleBan('${escapeAttribute(u.username)}', ${Boolean(u.isBanned)})">
                            ${u.isBanned ? "Unsuspend" : "Suspend"}
                        </button>
                    ` : ""}
                    <button class="action-chip neutral" type="button" title="Reset password" onclick="openResetPasswordModal('${escapeAttribute(u.username)}')">🔑 Reset</button>
                    ${!isCurrentAdmin ? `
                        <button class="action-chip danger" type="button" title="Delete user" onclick="adminDeleteUser('${escapeAttribute(u.username)}')">🗑️</button>
                    ` : ""}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function filterAdminUsers() {
    const q = document.getElementById("adminUserSearch").value.trim().toLowerCase();
    if (!q) {
        renderAdminUsersTable(adminData.users);
        return;
    }
    const filtered = adminData.users.filter(u => 
        u.username.toLowerCase().includes(q) || u.name.toLowerCase().includes(q) || (u.bio && u.bio.toLowerCase().includes(q))
    );
    renderAdminUsersTable(filtered);
}

function renderAdminPostsTable(list = adminData.posts) {
    const tbody = document.getElementById("adminPostsTableBody");
    tbody.innerHTML = "";

    if (!list || list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="table-empty">No posts found.</td></tr>`;
        return;
    }

    list.forEach(p => {
        const tr = document.createElement("tr");
        const formattedDate = new Date(p.createdAt).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
        const mediaHtml = p.image 
            ? `<a href="${escapeAttribute(p.image)}" target="_blank" rel="noopener" class="media-thumb-link"><img src="${escapeAttribute(p.image)}" class="table-post-thumb" alt="image"></a>`
            : `<span class="no-media">Text only</span>`;

        tr.innerHTML = `
            <td>#${p.id}</td>
            <td>
                <span class="table-user-handle user-clickable" onclick="viewUserProfile('${escapeAttribute(p.username)}')">@${escapeHTML(p.username)}</span>
            </td>
            <td>
                <div class="table-post-snippet" title="${escapeAttribute(p.text || "")}">${escapeHTML(p.text || "(Image post)")}</div>
            </td>
            <td>${mediaHtml}</td>
            <td>
                <div class="engagement-chips">
                    <span>❤️ ${p.likesCount}</span>
                    <span>💬 ${p.commentsCount}</span>
                </div>
            </td>
            <td class="table-date">${formattedDate}</td>
            <td>
                <button class="action-chip danger" type="button" title="Delete post" onclick="adminDeletePost(${p.id})">
                    🗑️ Delete
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function filterAdminPosts() {
    const q = document.getElementById("adminPostSearch").value.trim().toLowerCase();
    if (!q) {
        renderAdminPostsTable(adminData.posts);
        return;
    }
    const filtered = adminData.posts.filter(p => 
        p.username.toLowerCase().includes(q) || (p.text && p.text.toLowerCase().includes(q)) || String(p.id).includes(q)
    );
    renderAdminPostsTable(filtered);
}

function renderAdminCommentsTable(list = adminData.comments) {
    const tbody = document.getElementById("adminCommentsTableBody");
    tbody.innerHTML = "";

    if (!list || list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No comments found.</td></tr>`;
        return;
    }

    list.forEach(c => {
        const tr = document.createElement("tr");
        const dateStr = c.date ? new Date(c.date).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

        tr.innerHTML = `
            <td>#${c.id}</td>
            <td>
                <span class="table-user-handle user-clickable" onclick="viewUserProfile('${escapeAttribute(c.username)}')">@${escapeHTML(c.username)}</span>
            </td>
            <td>
                <span class="table-comment-text">${escapeHTML(c.text)}</span>
            </td>
            <td>
                <span class="post-id-tag">Post #${c.postId}</span>
            </td>
            <td class="table-date">${dateStr}</td>
            <td>
                <button class="action-chip danger" type="button" title="Delete comment" onclick="adminDeleteComment(${c.id})">
                    🗑️ Delete
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function adminToggleRole(username, currentIsAdmin) {
    const newRole = !currentIsAdmin;
    const actionLabel = newRole ? "promote to Administrator" : "demote to regular Member";
    if (!confirm(`Are you sure you want to ${actionLabel} @${username}?`)) return;

    try {
        await apiRequest(`/api/admin/users/${encodeURIComponent(username)}/role`, {
            method: "PATCH",
            body: JSON.stringify({ isAdmin: newRole })
        });
        showToast(`@${username} updated to ${newRole ? "Admin" : "Member"}.`);
        await loadAdminData();
        await refreshAppData();
    } catch (error) {
        showToast(error.message);
    }
}

async function adminDeleteUser(username) {
    if (!confirm(`CAUTION: Permanently delete @${username} and all their posts, comments, likes, and followers? This action cannot be undone.`)) {
        return;
    }

    try {
        await apiRequest(`/api/admin/users/${encodeURIComponent(username)}`, { method: "DELETE" });
        showToast(`User @${username} was deleted.`);
        await loadAdminData();
        await refreshAppData();
    } catch (error) {
        showToast(error.message);
    }
}

function openResetPasswordModal(username) {
    resetPasswordTargetUser = username;
    document.getElementById("resetTargetUsername").textContent = "@" + username;
    document.getElementById("adminNewPasswordInput").value = "";
    document.getElementById("adminResetPasswordModal").style.display = "flex";
}

function closeResetPasswordModal() {
    document.getElementById("adminResetPasswordModal").style.display = "none";
    resetPasswordTargetUser = null;
}

async function submitResetPassword() {
    if (!resetPasswordTargetUser) return;
    const newPassword = document.getElementById("adminNewPasswordInput").value;
    if (!newPassword || newPassword.length < 4) {
        showToast("Password must be at least 4 characters.");
        return;
    }

    try {
        await apiRequest(`/api/admin/users/${encodeURIComponent(resetPasswordTargetUser)}/reset-password`, {
            method: "POST",
            body: JSON.stringify({ newPassword })
        });
        closeResetPasswordModal();
        showToast(`Password for @${resetPasswordTargetUser} was updated!`);
    } catch (error) {
        showToast(error.message);
    }
}

async function adminDeletePost(postId) {
    if (!confirm(`Permanently delete post #${postId}?`)) return;

    try {
        await apiRequest(`/api/posts/${postId}`, { method: "DELETE" });
        showToast(`Post #${postId} deleted.`);
        await loadAdminData();
        await refreshAppData();
    } catch (error) {
        showToast(error.message);
    }
}

async function adminDeleteComment(commentId) {
    if (!confirm(`Delete comment #${commentId}?`)) return;

    try {
        await apiRequest(`/api/comments/${commentId}`, { method: "DELETE" });
        showToast(`Comment #${commentId} deleted.`);
        await loadAdminData();
        await refreshAppData();
    } catch (error) {
        showToast(error.message);
    }
}

async function adminSendBroadcast() {
    const messageInput = document.getElementById("broadcastMessage");
    const asPostCheckbox = document.getElementById("broadcastAsPost");
    const message = messageInput.value.trim();

    if (!message) {
        showToast("Please enter an announcement message.");
        return;
    }

    try {
        const result = await apiRequest("/api/admin/broadcast", {
            method: "POST",
            body: JSON.stringify({
                message,
                asPost: asPostCheckbox.checked
            })
        });
        messageInput.value = "";
        showToast(`Announcement broadcast to ${result.recipientsCount} users! 📢`);
        await loadAdminData();
        await refreshAppData();
        switchAdminTab("users");
    } catch (error) {
        showToast(error.message);
    }
}

async function adminToggleBan(username, currentIsBanned) {
    const actionLabel = currentIsBanned ? "unsuspend and reactivate" : "suspend";
    if (!confirm(`Are you sure you want to ${actionLabel} @${username}?`)) return;

    try {
        await apiRequest(`/api/admin/users/${encodeURIComponent(username)}/ban`, {
            method: "PATCH",
            body: JSON.stringify({ isBanned: !currentIsBanned })
        });
        showToast(`User @${username} was ${currentIsBanned ? "unsuspended" : "suspended"}.`);
        await loadAdminData();
        await refreshAppData();
    } catch (error) {
        showToast(error.message);
    }
}

function renderAdminLogsTable(list = adminData.logs) {
    const tbody = document.getElementById("adminLogsTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (!list || list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="table-empty">No audit logs recorded yet.</td></tr>`;
        return;
    }

    list.forEach(log => {
        const tr = document.createElement("tr");
        const dateStr = log.created_at ? new Date(log.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
        tr.innerHTML = `
            <td>#${log.id}</td>
            <td class="table-date">${dateStr}</td>
            <td><strong>@${escapeHTML(log.admin_username || "")}</strong></td>
            <td><span class="log-action-tag">${escapeHTML(log.action || "")}</span></td>
            <td class="log-target-cell">${escapeHTML(log.target || "—")}</td>
        `;
        tbody.appendChild(tr);
    });
}

function filterAdminLogs() {
    const q = document.getElementById("adminLogSearch").value.trim().toLowerCase();
    if (!q) {
        renderAdminLogsTable(adminData.logs);
        return;
    }
    const filtered = (adminData.logs || []).filter(l =>
        (l.admin_username && l.admin_username.toLowerCase().includes(q)) ||
        (l.action && l.action.toLowerCase().includes(q)) ||
        (l.target && l.target.toLowerCase().includes(q))
    );
    renderAdminLogsTable(filtered);
}

function downloadCSV(csvContent, fileName) {
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function exportUsersCSV() {
    if (!adminData.users || adminData.users.length === 0) {
        showToast("No user data available to export.");
        return;
    }
    const headers = ["Username", "Name", "Role", "Status", "Posts", "Followers", "Following", "Comments", "Bio"];
    const rows = adminData.users.map(u => [
        `"${u.username.replace(/"/g, '""')}"`,
        `"${(u.name || "").replace(/"/g, '""')}"`,
        u.isAdmin ? "Admin" : "Member",
        u.isBanned ? "Suspended" : "Active",
        u.postCount || 0,
        u.followerCount || 0,
        u.followingCount || 0,
        u.commentCount || 0,
        `"${(u.bio || "").replace(/"/g, '""')}"`
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\r\n");
    downloadCSV(csv, `siddverse_users_${new Date().toISOString().slice(0, 10)}.csv`);
    showToast("Users exported to CSV! 📥");
}

function exportPostsCSV() {
    if (!adminData.posts || adminData.posts.length === 0) {
        showToast("No post data available to export.");
        return;
    }
    const headers = ["ID", "Author", "Content", "HasImage", "Likes", "Comments", "CreatedAt"];
    const rows = adminData.posts.map(p => [
        p.id,
        `"${p.username.replace(/"/g, '""')}"`,
        `"${(p.text || "").replace(/"/g, '""')}"`,
        Boolean(p.image) ? "Yes" : "No",
        p.likesCount || 0,
        p.commentsCount || 0,
        `"${p.createdAt}"`
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\r\n");
    downloadCSV(csv, `siddverse_posts_${new Date().toISOString().slice(0, 10)}.csv`);
    showToast("Posts exported to CSV! 📥");
}

/* =====================================
   DARK MODE / CREATE POST FOCUS / TOAST
===================================== */

function toggleDarkMode() {
    document.body.classList.toggle("dark");
    localStorage.setItem("siddverse_dark", document.body.classList.contains("dark"));
    document.querySelector(".nav-actions .icon-btn").setAttribute(
        "aria-pressed",
        String(document.body.classList.contains("dark"))
    );
}

function focusCreatePost() {
    showHome();
    document.getElementById("postText").focus();
}

function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.style.display = "block";
    setTimeout(() => {
        toast.style.display = "none";
    }, 2800);
}

function updateStats() {
    const me = getCurrentUser();
    if (!me) return;

    const myPosts = posts.filter(p => p.username === currentUser).length;
    document.getElementById("statPosts").textContent = myPosts;
    document.getElementById("statFollowers").textContent = me.followers ? me.followers.length : 0;
    document.getElementById("statFollowing").textContent = me.following ? me.following.length : 0;
    document.getElementById("statSaved").textContent = getSavedForCurrentUser()
        .filter(postId => posts.some(post => post.id === postId)).length;

    document.getElementById("sidePostCount").textContent = myPosts;
    document.getElementById("sideFollowerCount").textContent = me.followers ? me.followers.length : 0;
    document.getElementById("sideFollowingCount").textContent = me.following ? me.following.length : 0;
}

/* =====================================
   SECURITY HELPERS
===================================== */

function escapeHTML(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function escapeAttribute(text) {
    return String(text)
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/* =====================================
   INITIALIZE
===================================== */

if (localStorage.getItem("siddverse_dark") === "true") {
    document.body.classList.add("dark");
    const darkToggle = document.querySelector(".nav-actions .icon-btn");
    if (darkToggle) darkToggle.setAttribute("aria-pressed", "true");
}

document.querySelectorAll(".filter-btn").forEach(button => {
    button.addEventListener("click", () => setFilter(button.dataset.filter));
});

apiRequest("/api/bootstrap")
    .then(data => {
        if (!data.authenticated) return;
        users = data.users || [];
        posts = data.posts || [];
        notifications = data.notifications || [];
        savedPosts = data.savedPosts || [];
        currentUser = data.currentUser || null;
        startApp();
    })
    .catch(error => {
        console.warn("Bootstrap info:", error);
    });
