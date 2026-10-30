const { createHash, randomBytes, scryptSync, timingSafeEqual } = require("node:crypto");
const { createServer } = require("node:http");
const { readFileSync, mkdirSync, statSync } = require("node:fs");
const { extname, resolve } = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const DATA_DIR = resolve(ROOT, "data");
const DATABASE_PATH = resolve(DATA_DIR, "siddverse.sqlite");
const SESSION_COOKIE = "siddverse_session";
const SESSION_DURATION = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10MB for local image data URLs
const MIME_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
};

mkdirSync(DATA_DIR, { recursive: true });
const database = new DatabaseSync(DATABASE_PATH);
database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
database.exec(`
    CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        bio TEXT NOT NULL DEFAULT '',
        avatar TEXT NOT NULL DEFAULT '',
        cover TEXT NOT NULL DEFAULT '',
        is_admin INTEGER NOT NULL DEFAULT 0,
        is_banned INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS follows (
        follower_username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        followed_username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        PRIMARY KEY (follower_username, followed_username),
        CHECK (follower_username <> followed_username)
    );
    CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        text TEXT NOT NULL DEFAULT '',
        image TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        is_edited INTEGER NOT NULL DEFAULT 0,
        poll_question TEXT NOT NULL DEFAULT '',
        poll_options TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS likes (
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        PRIMARY KEY (post_id, username)
    );
    CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS saved_posts (
        username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        PRIMARY KEY (username, post_id)
    );
    CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient_username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        sender_username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        is_read INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS poll_votes (
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        option_index INTEGER NOT NULL,
        PRIMARY KEY (post_id, username)
    );
    CREATE TABLE IF NOT EXISTS admin_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_username TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications(recipient_username, id DESC);
`);

// Migration: Ensure all newer columns and tables exist
function migrateDatabase() {
    const userColumns = database.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    if (!userColumns.includes("is_admin")) {
        database.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;");
    }
    if (!userColumns.includes("is_banned")) {
        database.exec("ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0;");
    }

    const postColumns = database.prepare("PRAGMA table_info(posts)").all().map(c => c.name);
    if (!postColumns.includes("is_edited")) {
        database.exec("ALTER TABLE posts ADD COLUMN is_edited INTEGER NOT NULL DEFAULT 0;");
    }
    if (!postColumns.includes("poll_question")) {
        database.exec("ALTER TABLE posts ADD COLUMN poll_question TEXT NOT NULL DEFAULT '';");
    }
    if (!postColumns.includes("poll_options")) {
        database.exec("ALTER TABLE posts ADD COLUMN poll_options TEXT NOT NULL DEFAULT '';");
    }

    database.exec(`
        CREATE TABLE IF NOT EXISTS poll_votes (
            post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
            username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
            option_index INTEGER NOT NULL,
            PRIMARY KEY (post_id, username)
        );
        CREATE TABLE IF NOT EXISTS admin_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_username TEXT NOT NULL,
            action TEXT NOT NULL,
            target TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
    `);
}
migrateDatabase();

const statements = {
    userByUsername: database.prepare("SELECT * FROM users WHERE username = ?"),
    publicUsers: database.prepare("SELECT username, name, bio, avatar, cover, is_admin AS isAdmin, is_banned AS isBanned FROM users ORDER BY username"),
    userFollows: database.prepare("SELECT followed_username FROM follows WHERE follower_username = ?"),
    userFollowers: database.prepare("SELECT follower_username FROM follows WHERE followed_username = ?"),
    postRows: database.prepare(`
        SELECT id, username, text, image, created_at AS createdAt, is_edited AS isEdited,
            poll_question AS pollQuestion, poll_options AS pollOptions
        FROM posts ORDER BY created_at DESC, id DESC
    `),
    postLikes: database.prepare("SELECT username FROM likes WHERE post_id = ? ORDER BY username"),
    postComments: database.prepare("SELECT id, username, text, created_at AS date FROM comments WHERE post_id = ? ORDER BY id"),
    notifications: database.prepare(`
        SELECT id, recipient_username AS "to", sender_username AS "from", text, created_at AS date, is_read AS read
        FROM notifications WHERE recipient_username = ? ORDER BY id
    `),
    savedPosts: database.prepare("SELECT post_id FROM saved_posts WHERE username = ?"),
    insertNotification: database.prepare(`
        INSERT INTO notifications (recipient_username, sender_username, text, created_at)
        VALUES (?, ?, ?, ?)
    `)
};

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
    return {
        salt,
        hash: scryptSync(password, salt, 64).toString("hex")
    };
}

function passwordMatches(password, user) {
    const candidate = Buffer.from(hashPassword(password, user.password_salt).hash, "hex");
    const stored = Buffer.from(user.password_hash, "hex");
    return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

function logAdminAction(adminUsername, action, target = "") {
    try {
        database.prepare(`
            INSERT INTO admin_logs (admin_username, action, target, created_at)
            VALUES (?, ?, ?, ?)
        `).run(adminUsername, action, target, new Date().toISOString());
    } catch {}
}

function publicUser(username) {
    const user = statements.userByUsername.get(username);
    if (!user) return null;
    return {
        username: user.username,
        name: user.name,
        bio: user.bio,
        avatar: user.avatar,
        cover: user.cover,
        isAdmin: Boolean(user.is_admin),
        isBanned: Boolean(user.is_banned),
        followers: statements.userFollowers.all(username).map(row => row.follower_username),
        following: statements.userFollows.all(username).map(row => row.followed_username)
    };
}

function initializeDemoData() {
    const existingCount = database.prepare("SELECT COUNT(*) AS count FROM users").get().count;
    if (existingCount === 0) {
        const demoUsers = [
            { name: "Siddhant", username: "siddhant", password: "1234", bio: "Building ideas that matter. 🚀 Founder & Admin.", isAdmin: 1 },
            { name: "System Admin", username: "admin", password: "1234", bio: "Official SiddVerse Platform Administrator 🛡️", isAdmin: 1 },
            { name: "Priya Sharma", username: "priya", password: "1234", bio: "Photography & Travel 📸", isAdmin: 0 },
            { name: "Rahul Patil", username: "rahul", password: "1234", bio: "Coding enthusiast 💻", isAdmin: 0 }
        ];

        database.exec("BEGIN IMMEDIATE");
        try {
            const insertUser = database.prepare(`
                INSERT INTO users (username, name, password_salt, password_hash, bio, is_admin, is_banned)
                VALUES (?, ?, ?, ?, ?, ?, 0)
            `);
            for (const user of demoUsers) {
                const password = hashPassword(user.password);
                insertUser.run(user.username, user.name, password.salt, password.hash, user.bio, user.isAdmin);
            }

            const insertFollow = database.prepare("INSERT INTO follows (follower_username, followed_username) VALUES (?, ?)");
            for (const [follower, followed] of [
                ["priya", "siddhant"], ["rahul", "siddhant"],
                ["siddhant", "priya"], ["priya", "rahul"]
            ]) insertFollow.run(follower, followed);

            const insertPost = database.prepare("INSERT INTO posts (username, text, image, created_at, poll_question, poll_options) VALUES (?, ?, ?, ?, ?, ?)");
            const insertLike = database.prepare("INSERT INTO likes (post_id, username) VALUES (?, ?)");
            const insertComment = database.prepare("INSERT INTO comments (post_id, username, text, created_at) VALUES (?, ?, ?, ?)");
            const now = Date.now();
            const firstPost = insertPost.run(
                "siddhant",
                "Just launched a fresh idea for a student community app. Feedback would help a lot!",
                "",
                new Date(now - 30 * 60 * 1000).toISOString(),
                "What feature should we build next?",
                JSON.stringify(["Interactive Polls", "Dark Mode", "File Uploads", "Admin Dashboard"])
            ).lastInsertRowid;
            const secondPost = insertPost.run(
                "priya",
                "Weekend photo walk and a new reel idea. What do you think of this aesthetic?",
                "https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=1200&q=80",
                new Date(now - 90 * 60 * 1000).toISOString(),
                "",
                ""
            ).lastInsertRowid;
            const thirdPost = insertPost.run(
                "rahul",
                "Building a cleaner UI always feels like a productivity boost. Small improvements matter a lot. #coding #tech",
                "",
                new Date(now - 180 * 60 * 1000).toISOString(),
                "",
                ""
            ).lastInsertRowid;

            insertLike.run(firstPost, "priya");
            insertLike.run(secondPost, "siddhant");
            insertLike.run(secondPost, "rahul");
            insertComment.run(firstPost, "rahul", "This looks awesome!", new Date(now - 20 * 60 * 1000).toISOString());
            insertComment.run(secondPost, "siddhant", "Love the vibe.", new Date(now - 80 * 60 * 1000).toISOString());
            insertComment.run(thirdPost, "priya", "Totally agree.", new Date(now - 170 * 60 * 1000).toISOString());

            // Seed sample poll votes
            database.prepare("INSERT INTO poll_votes (post_id, username, option_index) VALUES (?, ?, ?)").run(firstPost, "priya", 0);
            database.prepare("INSERT INTO poll_votes (post_id, username, option_index) VALUES (?, ?, ?)").run(firstPost, "rahul", 2);

            database.exec("COMMIT");
        } catch (error) {
            database.exec("ROLLBACK");
            throw error;
        }
    } else {
        database.prepare("UPDATE users SET is_admin = 1 WHERE username = 'siddhant'").run();
        if (!statements.userByUsername.get("admin")) {
            const adminPass = hashPassword("1234");
            database.prepare(`
                INSERT INTO users (username, name, password_salt, password_hash, bio, is_admin, is_banned)
                VALUES ('admin', 'System Administrator', ?, ?, 'Official SiddVerse Platform Administrator 🛡️', 1, 0)
            `).run(adminPass.salt, adminPass.hash);
        }
    }
}

initializeDemoData();

function jsonResponse(response, status, value, extraHeaders = {}) {
    response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...extraHeaders
    });
    response.end(JSON.stringify(value));
}

function readJson(request) {
    return new Promise((resolveBody, reject) => {
        let body = "";
        request.on("data", chunk => {
            body += chunk;
            if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
                reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
                request.destroy();
            }
        });
        request.on("end", () => {
            if (!body) {
                resolveBody({});
                return;
            }
            try {
                resolveBody(JSON.parse(body));
            } catch {
                reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
            }
        });
        request.on("error", reject);
    });
}

function getSessionToken(request) {
    const cookieHeader = request.headers.cookie || "";
    const cookie = cookieHeader.split(";").map(value => value.trim())
        .find(value => value.startsWith(`${SESSION_COOKIE}=`));
    return cookie ? decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1)) : "";
}

function getAuthenticatedUser(request) {
    const token = getSessionToken(request);
    if (!token) return null;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const session = database.prepare(`
        SELECT username FROM sessions WHERE token_hash = ? AND expires_at > ?
    `).get(tokenHash, Date.now());
    if (!session) return null;
    return publicUser(session.username);
}

function createSession(username) {
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    database.prepare("INSERT INTO sessions (token_hash, username, expires_at) VALUES (?, ?, ?)")
        .run(tokenHash, username, Date.now() + SESSION_DURATION);
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DURATION / 1000}`;
}

function clearSession(request) {
    const token = getSessionToken(request);
    if (token) {
        const tokenHash = createHash("sha256").update(token).digest("hex");
        database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    }
    return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

function isValidOptionalUrl(value) {
    if (!value || value === "") return true;
    if (value.startsWith("data:image/")) return true; // Local file upload
    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:";
    } catch {
        return false;
    }
}

function getBootstrap(username) {
    const user = statements.userByUsername.get(username);
    const users = statements.publicUsers.all().map(row => ({
        ...row,
        isAdmin: Boolean(row.isAdmin),
        isBanned: Boolean(row.isBanned),
        followers: statements.userFollowers.all(row.username).map(item => item.follower_username),
        following: statements.userFollows.all(row.username).map(item => item.followed_username)
    }));

    const voteStmt = database.prepare("SELECT option_index, username FROM poll_votes WHERE post_id = ?");

    const posts = statements.postRows.all().map(post => {
        let poll = null;
        if (post.pollQuestion) {
            let options = [];
            try { options = JSON.parse(post.pollOptions); } catch {}
            const votes = voteStmt.all(post.id);
            poll = {
                question: post.pollQuestion,
                options: options.map((optText, idx) => ({
                    text: optText,
                    votes: votes.filter(v => v.option_index === idx).length
                })),
                totalVotes: votes.length,
                userVote: votes.find(v => v.username === username)?.option_index ?? null
            };
        }

        return {
            id: Number(post.id),
            username: post.username,
            text: post.text,
            image: post.image,
            createdAt: post.createdAt,
            isEdited: Boolean(post.isEdited),
            poll,
            likes: statements.postLikes.all(post.id).map(row => row.username),
            comments: statements.postComments.all(post.id).map(c => ({
                id: Number(c.id),
                username: c.username,
                text: c.text,
                date: c.date
            }))
        };
    });

    const notifications = statements.notifications.all(username).map(notification => ({
        ...notification,
        read: Boolean(notification.read)
    }));
    const savedPosts = statements.savedPosts.all(username).map(row => Number(row.post_id));

    return {
        users,
        posts,
        notifications,
        savedPosts,
        currentUser: username,
        isAdmin: Boolean(user && user.is_admin),
        isBanned: Boolean(user && user.is_banned)
    };
}

function requireAdmin(user, response) {
    if (!user || !user.isAdmin) {
        jsonResponse(response, 403, { error: "Access denied. Administrator privileges required." });
        return false;
    }
    return true;
}

async function handleApi(request, response, url) {
    const { pathname } = url;
    const method = request.method;

    if (pathname === "/api/auth/register" && method === "POST") {
        const body = await readJson(request);
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
        const password = typeof body.password === "string" ? body.password : "";
        if (!name || name.length > 80 || !/^[a-z0-9_]{3,20}$/.test(username) || password.length < 4 || password.length > 128) {
            return jsonResponse(response, 400, { error: "Enter a name, a valid username, and a password of at least 4 characters." });
        }
        if (statements.userByUsername.get(username)) {
            return jsonResponse(response, 409, { error: "Username already exists." });
        }
        const passwordData = hashPassword(password);
        database.prepare(`
            INSERT INTO users (username, name, password_salt, password_hash, bio, is_admin, is_banned)
            VALUES (?, ?, ?, ?, ?, 0, 0)
        `).run(username, name, passwordData.salt, passwordData.hash, "Welcome to SiddVerse! ✨");
        return jsonResponse(response, 201, { user: publicUser(username) });
    }

    if (pathname === "/api/auth/login" && method === "POST") {
        const body = await readJson(request);
        const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
        const password = typeof body.password === "string" ? body.password : "";
        const user = statements.userByUsername.get(username);
        if (!user || !passwordMatches(password, user)) {
            return jsonResponse(response, 401, { error: "Invalid username or password." });
        }
        if (user.is_banned) {
            return jsonResponse(response, 403, { error: "This account has been suspended by an administrator." });
        }
        const cookie = createSession(username);
        return jsonResponse(response, 200, { user: publicUser(username) }, { "Set-Cookie": cookie });
    }

    if (pathname === "/api/auth/session" && method === "DELETE") {
        return jsonResponse(response, 200, { ok: true }, { "Set-Cookie": clearSession(request) });
    }

    if (pathname === "/api/bootstrap" && method === "GET") {
        const user = getAuthenticatedUser(request);
        if (!user) return jsonResponse(response, 200, { authenticated: false });
        return jsonResponse(response, 200, { authenticated: true, ...getBootstrap(user.username) });
    }

    const user = getAuthenticatedUser(request);
    if (!user) return jsonResponse(response, 401, { error: "Please log in to continue." });
    if (user.isBanned) return jsonResponse(response, 403, { error: "Your account is suspended." });

    // -------------------------------------------------------------
    // ADMIN ENDPOINTS
    // -------------------------------------------------------------
    if (pathname === "/api/admin/stats" && method === "GET") {
        if (!requireAdmin(user, response)) return;
        const totalUsers = database.prepare("SELECT COUNT(*) AS count FROM users").get().count;
        const totalAdmins = database.prepare("SELECT COUNT(*) AS count FROM users WHERE is_admin = 1").get().count;
        const totalBanned = database.prepare("SELECT COUNT(*) AS count FROM users WHERE is_banned = 1").get().count;
        const totalPosts = database.prepare("SELECT COUNT(*) AS count FROM posts").get().count;
        const postsWithImages = database.prepare("SELECT COUNT(*) AS count FROM posts WHERE image != ''").get().count;
        const totalPolls = database.prepare("SELECT COUNT(*) AS count FROM posts WHERE poll_question != ''").get().count;
        const totalComments = database.prepare("SELECT COUNT(*) AS count FROM comments").get().count;
        const totalLikes = database.prepare("SELECT COUNT(*) AS count FROM likes").get().count;
        const totalFollows = database.prepare("SELECT COUNT(*) AS count FROM follows").get().count;

        let dbSizeBytes = 0;
        try {
            dbSizeBytes = statSync(DATABASE_PATH).size;
        } catch {}

        return jsonResponse(response, 200, {
            stats: {
                totalUsers,
                totalAdmins,
                totalBanned,
                totalPosts,
                postsWithImages,
                totalPolls,
                totalComments,
                totalLikes,
                totalFollows,
                uptimeSeconds: Math.floor(process.uptime()),
                nodeVersion: process.version,
                dbSizeBytes
            }
        });
    }

    if (pathname === "/api/admin/users" && method === "GET") {
        if (!requireAdmin(user, response)) return;
        const allUsers = database.prepare(`
            SELECT u.username, u.name, u.bio, u.avatar, u.cover, u.is_admin, u.is_banned,
                (SELECT COUNT(*) FROM posts WHERE username = u.username) AS postCount,
                (SELECT COUNT(*) FROM follows WHERE followed_username = u.username) AS followerCount,
                (SELECT COUNT(*) FROM follows WHERE follower_username = u.username) AS followingCount,
                (SELECT COUNT(*) FROM comments WHERE username = u.username) AS commentCount
            FROM users u
            ORDER BY u.is_admin DESC, u.is_banned ASC, u.username ASC
        `).all().map(row => ({
            ...row,
            isAdmin: Boolean(row.is_admin),
            isBanned: Boolean(row.is_banned)
        }));
        return jsonResponse(response, 200, { users: allUsers });
    }

    const adminRoleMatch = pathname.match(/^\/api\/admin\/users\/([a-z0-9_]{3,20})\/role$/);
    if (adminRoleMatch && method === "PATCH") {
        if (!requireAdmin(user, response)) return;
        const target = adminRoleMatch[1];
        const targetUser = statements.userByUsername.get(target);
        if (!targetUser) return jsonResponse(response, 404, { error: "User not found." });

        const body = await readJson(request);
        const newIsAdmin = Boolean(body.isAdmin);

        if (!newIsAdmin && target === user.username) {
            const adminCount = database.prepare("SELECT COUNT(*) AS count FROM users WHERE is_admin = 1").get().count;
            if (adminCount <= 1) {
                return jsonResponse(response, 400, { error: "Cannot remove the only administrator." });
            }
        }

        database.prepare("UPDATE users SET is_admin = ? WHERE username = ?").run(newIsAdmin ? 1 : 0, target);
        logAdminAction(user.username, newIsAdmin ? "Promoted to Admin" : "Demoted to Member", `@${target}`);
        return jsonResponse(response, 200, { ok: true, isAdmin: newIsAdmin });
    }

    const adminBanMatch = pathname.match(/^\/api\/admin\/users\/([a-z0-9_]{3,20})\/ban$/);
    if (adminBanMatch && method === "PATCH") {
        if (!requireAdmin(user, response)) return;
        const target = adminBanMatch[1];
        if (target === user.username) return jsonResponse(response, 400, { error: "You cannot suspend your own admin account." });
        const targetUser = statements.userByUsername.get(target);
        if (!targetUser) return jsonResponse(response, 404, { error: "User not found." });

        const body = await readJson(request);
        const newIsBanned = Boolean(body.isBanned);
        database.prepare("UPDATE users SET is_banned = ? WHERE username = ?").run(newIsBanned ? 1 : 0, target);
        if (newIsBanned) {
            database.prepare("DELETE FROM sessions WHERE username = ?").run(target);
        }
        logAdminAction(user.username, newIsBanned ? "Suspended User" : "Reactivated User", `@${target}`);
        return jsonResponse(response, 200, { ok: true, isBanned: newIsBanned });
    }

    const adminDeleteUserMatch = pathname.match(/^\/api\/admin\/users\/([a-z0-9_]{3,20})$/);
    if (adminDeleteUserMatch && method === "DELETE") {
        if (!requireAdmin(user, response)) return;
        const target = adminDeleteUserMatch[1];
        if (target === user.username) {
            return jsonResponse(response, 400, { error: "You cannot delete your own admin account." });
        }
        const targetUser = statements.userByUsername.get(target);
        if (!targetUser) return jsonResponse(response, 404, { error: "User not found." });

        database.prepare("DELETE FROM users WHERE username = ?").run(target);
        logAdminAction(user.username, "Deleted User Account", `@${target}`);
        return jsonResponse(response, 200, { ok: true });
    }

    const adminResetPassMatch = pathname.match(/^\/api\/admin\/users\/([a-z0-9_]{3,20})\/reset-password$/);
    if (adminResetPassMatch && method === "POST") {
        if (!requireAdmin(user, response)) return;
        const target = adminResetPassMatch[1];
        const targetUser = statements.userByUsername.get(target);
        if (!targetUser) return jsonResponse(response, 404, { error: "User not found." });

        const body = await readJson(request);
        const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
        if (newPassword.length < 4 || newPassword.length > 128) {
            return jsonResponse(response, 400, { error: "New password must be at least 4 characters." });
        }

        const passwordData = hashPassword(newPassword);
        database.prepare("UPDATE users SET password_salt = ?, password_hash = ? WHERE username = ?")
            .run(passwordData.salt, passwordData.hash, target);
        database.prepare("DELETE FROM sessions WHERE username = ?").run(target);
        logAdminAction(user.username, "Reset User Password", `@${target}`);

        return jsonResponse(response, 200, { ok: true });
    }

    if (pathname === "/api/admin/posts" && method === "GET") {
        if (!requireAdmin(user, response)) return;
        const allPosts = database.prepare(`
            SELECT p.id, p.username, p.text, p.image, p.created_at AS createdAt,
                (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS likesCount,
                (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS commentsCount
            FROM posts p
            ORDER BY p.id DESC
        `).all();
        return jsonResponse(response, 200, { posts: allPosts });
    }

    if (pathname === "/api/admin/comments" && method === "GET") {
        if (!requireAdmin(user, response)) return;
        const allComments = database.prepare(`
            SELECT c.id, c.post_id AS postId, c.username, c.text, c.created_at AS date,
                p.username AS postAuthor
            FROM comments c
            LEFT JOIN posts p ON c.post_id = p.id
            ORDER BY c.id DESC
            LIMIT 150
        `).all();
        return jsonResponse(response, 200, { comments: allComments });
    }

    if (pathname === "/api/admin/logs" && method === "GET") {
        if (!requireAdmin(user, response)) return;
        const logs = database.prepare("SELECT * FROM admin_logs ORDER BY id DESC LIMIT 100").all();
        return jsonResponse(response, 200, { logs });
    }

    if (pathname === "/api/admin/broadcast" && method === "POST") {
        if (!requireAdmin(user, response)) return;
        const body = await readJson(request);
        const message = typeof body.message === "string" ? body.message.trim() : "";
        const asPost = Boolean(body.asPost);

        if (!message || message.length > 2000) {
            return jsonResponse(response, 400, { error: "Broadcast message must be between 1 and 2,000 characters." });
        }

        const now = new Date().toISOString();
        const allUsernames = database.prepare("SELECT username FROM users").all().map(r => r.username);
        const insertNotif = database.prepare(`
            INSERT INTO notifications (recipient_username, sender_username, text, created_at)
            VALUES (?, ?, ?, ?)
        `);

        database.exec("BEGIN IMMEDIATE");
        try {
            for (const recipient of allUsernames) {
                insertNotif.run(recipient, user.username, `📢 ANNOUNCEMENT: ${message}`, now);
            }
            if (asPost) {
                database.prepare(`
                    INSERT INTO posts (username, text, image, created_at)
                    VALUES (?, ?, ?, ?)
                `).run(user.username, `📢 [COMMUNITY ANNOUNCEMENT]\n\n${message}`, "", now);
            }
            database.exec("COMMIT");
            logAdminAction(user.username, "Sent System Broadcast", `${allUsernames.length} users`);
        } catch (e) {
            database.exec("ROLLBACK");
            throw e;
        }

        return jsonResponse(response, 200, { ok: true, recipientsCount: allUsernames.length });
    }

    // -------------------------------------------------------------
    // REGULAR APP ENDPOINTS
    // -------------------------------------------------------------
    if (pathname === "/api/posts" && method === "POST") {
        const body = await readJson(request);
        const text = typeof body.text === "string" ? body.text.trim() : "";
        const image = typeof body.image === "string" ? body.image.trim() : "";
        const pollQuestion = typeof body.pollQuestion === "string" ? body.pollQuestion.trim() : "";
        const pollOptions = Array.isArray(body.pollOptions) ? body.pollOptions.map(o => String(o).trim()).filter(Boolean) : [];

        if ((!text && !image && !pollQuestion) || text.length > 5000 || !isValidOptionalUrl(image)) {
            return jsonResponse(response, 400, { error: "Add post text, an image, or a poll. Posts are limited to 5,000 characters." });
        }
        if (pollQuestion && pollOptions.length < 2) {
            return jsonResponse(response, 400, { error: "A poll must have at least 2 options." });
        }

        const result = database.prepare(`
            INSERT INTO posts (username, text, image, created_at, poll_question, poll_options)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(user.username, text, image, new Date().toISOString(), pollQuestion, JSON.stringify(pollOptions));

        return jsonResponse(response, 201, { id: Number(result.lastInsertRowid) });
    }

    // Delete single comment
    const commentMatch = pathname.match(/^\/api\/comments\/(\d+)$/);
    if (commentMatch && method === "DELETE") {
        const commentId = Number(commentMatch[1]);
        const comment = database.prepare("SELECT id, post_id, username FROM comments WHERE id = ?").get(commentId);
        if (!comment) return jsonResponse(response, 404, { error: "Comment not found." });
        const post = database.prepare("SELECT username FROM posts WHERE id = ?").get(comment.post_id);
        const isOwner = comment.username === user.username;
        const isPostAuthor = post && post.username === user.username;
        if (!isOwner && !isPostAuthor && !user.isAdmin) {
            return jsonResponse(response, 403, { error: "You are not authorized to delete this comment." });
        }
        database.prepare("DELETE FROM comments WHERE id = ?").run(commentId);
        if (user.isAdmin && !isOwner) {
            logAdminAction(user.username, "Deleted Comment", `Comment #${commentId} by @${comment.username}`);
        }
        return jsonResponse(response, 200, { ok: true });
    }

    const postMatch = pathname.match(/^\/api\/posts\/(\d+)(?:\/(like|comments|save|vote))?$/);
    if (postMatch) {
        const postId = Number(postMatch[1]);
        const action = postMatch[2] || "";
        const post = database.prepare("SELECT id, username, poll_question, poll_options FROM posts WHERE id = ?").get(postId);
        if (!post) return jsonResponse(response, 404, { error: "Post not found." });

        // Edit post
        if (!action && method === "PATCH") {
            if (post.username !== user.username && !user.isAdmin) {
                return jsonResponse(response, 403, { error: "You can edit only your own posts." });
            }
            const body = await readJson(request);
            const text = typeof body.text === "string" ? body.text.trim() : "";
            const image = typeof body.image === "string" ? body.image.trim() : "";
            if (!text && !image) return jsonResponse(response, 400, { error: "Post cannot be completely empty." });
            if (!isValidOptionalUrl(image)) return jsonResponse(response, 400, { error: "Invalid image format." });

            database.prepare("UPDATE posts SET text = ?, image = ?, is_edited = 1 WHERE id = ?")
                .run(text, image, postId);
            return jsonResponse(response, 200, { ok: true });
        }

        // Delete post
        if (!action && method === "DELETE") {
            if (post.username !== user.username && !user.isAdmin) {
                return jsonResponse(response, 403, { error: "You can delete only your own posts." });
            }
            database.prepare("DELETE FROM posts WHERE id = ?").run(postId);
            if (user.isAdmin && post.username !== user.username) {
                logAdminAction(user.username, "Deleted Post", `Post #${postId} by @${post.username}`);
            }
            return jsonResponse(response, 200, { ok: true });
        }

        // Poll voting
        if (action === "vote" && method === "POST") {
            if (!post.poll_question) return jsonResponse(response, 400, { error: "This post has no poll." });
            const body = await readJson(request);
            const optionIndex = Number(body.optionIndex);
            let options = [];
            try { options = JSON.parse(post.poll_options); } catch {}
            if (Number.isNaN(optionIndex) || optionIndex < 0 || optionIndex >= options.length) {
                return jsonResponse(response, 400, { error: "Invalid poll option." });
            }

            database.prepare(`
                INSERT INTO poll_votes (post_id, username, option_index) VALUES (?, ?, ?)
                ON CONFLICT(post_id, username) DO UPDATE SET option_index = excluded.option_index
            `).run(postId, user.username, optionIndex);

            return jsonResponse(response, 200, { ok: true, optionIndex });
        }

        if (action === "like" && method === "POST") {
            const existing = database.prepare("SELECT 1 FROM likes WHERE post_id = ? AND username = ?").get(postId, user.username);
            if (existing) {
                database.prepare("DELETE FROM likes WHERE post_id = ? AND username = ?").run(postId, user.username);
            } else {
                database.prepare("INSERT INTO likes (post_id, username) VALUES (?, ?)").run(postId, user.username);
                if (post.username !== user.username) {
                    statements.insertNotification.run(post.username, user.username, "liked your post ❤️", new Date().toISOString());
                }
            }
            return jsonResponse(response, 200, { liked: !existing });
        }

        if (action === "comments" && method === "POST") {
            const body = await readJson(request);
            const text = typeof body.text === "string" ? body.text.trim() : "";
            if (!text || text.length > 1000) return jsonResponse(response, 400, { error: "Comments must contain 1–1,000 characters." });
            const result = database.prepare(`
                INSERT INTO comments (post_id, username, text, created_at) VALUES (?, ?, ?, ?)
            `).run(postId, user.username, text, new Date().toISOString());
            if (post.username !== user.username) {
                statements.insertNotification.run(post.username, user.username, "commented on your post 💬", new Date().toISOString());
            }
            return jsonResponse(response, 201, { ok: true, id: Number(result.lastInsertRowid) });
        }

        if (action === "save" && method === "POST") {
            const existing = database.prepare("SELECT 1 FROM saved_posts WHERE username = ? AND post_id = ?").get(user.username, postId);
            if (existing) {
                database.prepare("DELETE FROM saved_posts WHERE username = ? AND post_id = ?").run(user.username, postId);
            } else {
                database.prepare("INSERT INTO saved_posts (username, post_id) VALUES (?, ?)").run(user.username, postId);
            }
            return jsonResponse(response, 200, { saved: !existing });
        }
    }

    const followMatch = pathname.match(/^\/api\/users\/([a-z0-9_]{3,20})\/follow$/);
    if (followMatch && method === "POST") {
        const target = followMatch[1];
        if (target === user.username) return jsonResponse(response, 400, { error: "You cannot follow yourself." });
        if (!statements.userByUsername.get(target)) return jsonResponse(response, 404, { error: "User not found." });
        const existing = database.prepare("SELECT 1 FROM follows WHERE follower_username = ? AND followed_username = ?").get(user.username, target);
        if (existing) {
            database.prepare("DELETE FROM follows WHERE follower_username = ? AND followed_username = ?").run(user.username, target);
        } else {
            database.prepare("INSERT INTO follows (follower_username, followed_username) VALUES (?, ?)").run(user.username, target);
            statements.insertNotification.run(target, user.username, "started following you 👥", new Date().toISOString());
        }
        return jsonResponse(response, 200, { following: !existing });
    }

    if (pathname === "/api/profile" && method === "PATCH") {
        const body = await readJson(request);
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const bio = typeof body.bio === "string" ? body.bio.trim() : "";
        const avatar = typeof body.avatar === "string" ? body.avatar.trim() : "";
        const cover = typeof body.cover === "string" ? body.cover.trim() : "";
        if (!name || name.length > 80 || bio.length > 300 || !isValidOptionalUrl(avatar) || !isValidOptionalUrl(cover)) {
            return jsonResponse(response, 400, { error: "Check the profile fields. Names are required and bios are limited to 300 characters." });
        }
        database.prepare("UPDATE users SET name = ?, bio = ?, avatar = ?, cover = ? WHERE username = ?")
            .run(name, bio, avatar, cover, user.username);
        return jsonResponse(response, 200, { user: publicUser(user.username) });
    }

    if (pathname === "/api/notifications/read" && method === "POST") {
        database.prepare("UPDATE notifications SET is_read = 1 WHERE recipient_username = ?").run(user.username);
        return jsonResponse(response, 200, { ok: true });
    }

    return jsonResponse(response, 404, { error: "API endpoint not found." });
}

function serveStatic(response, url) {
    let requestedPath = url.pathname === "/" || url.pathname === "/admin" ? "/index.html" : decodeURIComponent(url.pathname);
    if (!["/index.html", "/script.js", "/style.css"].includes(requestedPath)) {
        response.writeHead(404);
        response.end("Not found");
        return;
    }

    try {
        const filePath = resolve(ROOT, requestedPath.slice(1));
        const contents = readFileSync(filePath);
        response.writeHead(200, {
            "Content-Type": MIME_TYPES[extname(filePath)] || "application/octet-stream",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-cache"
        });
        response.end(contents);
    } catch (error) {
        if (error.code === "ENOENT" || error.code === "EISDIR") {
            response.writeHead(404);
            response.end("Not found");
            return;
        }
        throw error;
    }
}

const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    try {
        if (url.pathname.startsWith("/api/")) {
            await handleApi(request, response, url);
        } else if (request.method === "GET" || request.method === "HEAD") {
            serveStatic(response, url);
        } else {
            jsonResponse(response, 405, { error: "Method not allowed." });
        }
    } catch (error) {
        if (response.headersSent) {
            response.destroy(error);
            return;
        }
        if (error.status) {
            jsonResponse(response, error.status, { error: error.message });
            return;
        }
        console.error(error);
        jsonResponse(response, 500, { error: "An unexpected server error occurred." });
    }
});

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);
server.listen(port, host, () => {
    const address = server.address();
    console.log(`SiddVerse is running at http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${address.port}`);
    console.log(`SQLite database: ${DATABASE_PATH}`);
});

function closeDatabase() {
    server.close(() => {
        database.close();
    });
}

process.on("SIGINT", closeDatabase);
process.on("SIGTERM", closeDatabase);
