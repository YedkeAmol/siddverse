# SiddVerse

SiddVerse is a modern social-community platform with a built-in Node.js server, native SQLite persistence, and an interactive **Admin Dashboard**.

Accounts, profiles, posts, polls, likes, comments, follows, saved posts, and audit logs are stored in SQLite. Passwords are stored as salted scrypt hashes, and login sessions use secure HTTP-only cookies.

## Features

- **🛡️ Full Administrator Dashboard**:
  - Live platform statistics (Users, Admins, Posts, Comments, Likes, Follows, DB size, Server Uptime).
  - User management: search users, promote/demote administrators, suspend/reactivate accounts, reset passwords, permanently delete accounts.
  - Content moderation: search and delete any violating posts or comments across the platform.
  - Audit logs: real-time chronological log of administrative actions.
  - CSV exports: 1-click export of user and post datasets.
  - System announcements: broadcast official system notifications to all community members and optionally publish an official announcement post.
- **📊 Interactive Community Polls**:
  - Create multi-option polls (2–4 options) attached to any post.
  - Real-time vote percentage progress bars and vote tally updates.
- **📷 Local Photo Uploads & Instant Previews**:
  - Upload photos directly from your computer (PNG, JPG, WebP) without external image hosting.
  - Instant image preview thumbnail with 1-click removal.
- **✏️ Post Editing**:
  - Edit post text and attachments at any time with an `(edited)` timestamp marker.
- **🔖 Dedicated Bookmarks / Saved Posts**:
  - Dedicated Saved Posts navigation in the sidebar and feed toolbar.
- **👤 Interactive User Profiles**:
  - Click any avatar or username anywhere (feed, comments, suggestions, notifications) to view that user's profile and posts.
  - Follow / Unfollow other creators directly from their profile page.
  - Edit your own profile name, bio, and upload avatar & cover banner files.
- **💬 Community Discussions & Moderation**:
  - Delete individual comments (author, post owner, or admin).
  - Clickable hashtags (`#coding`, `#tech`, etc.) to filter the feed.
- **📸 Interactive Story Strip**:
  - Category filters for All Stories, Photos, Tech, and Campus.
- **🔍 Universal Search**:
  - Instant live search across posts, @users, and #topics with automatic view switching.
- **🌙 Dark Mode & Responsive Layout**:
  - Full dark mode support and responsive design for mobile, tablet, and desktop.

## Run locally

1. Install Node.js 22.13 or newer.
2. From this folder, run `npm start` (or double-click `start.bat`).
3. Open <http://127.0.0.1:3000>.

The database is created automatically at `data/siddverse.sqlite`. Stop the server with Ctrl+C; your data remains in the database on the next run.

The server uses Node's built-in `node:sqlite` module, so no external npm dependencies or installations are needed.

## Accounts

| Username | Password | Role | Description |
| --- | --- | --- | --- |
| `admin` | `1234` | **System Administrator** | Full platform monitoring, moderation & broadcast access |
| `siddhant` | `1234` | **Founder & Admin** | Full admin privileges and community creator |
| `priya` | `1234` | Member | Photography & Travel creator |
| `rahul` | `1234` | Member | Coding & Tech enthusiast |

This prototype binds to localhost (`127.0.0.1`). Do not expose it to the public internet or use real passwords in production environments.
