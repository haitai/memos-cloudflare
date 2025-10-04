DROP TABLE IF EXISTS memo_resource;
DROP TABLE IF EXISTS memo_tag;
DROP TABLE IF EXISTS resource;
DROP TABLE IF EXISTS tag;
DROP TABLE IF EXISTS memo;
DROP TABLE IF EXISTS user;
DROP TABLE IF EXISTS user_setting;

CREATE TABLE user (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    password_hash TEXT NOT NULL,
    nickname TEXT,
    avatar_url TEXT,
    description TEXT,
    role TEXT NOT NULL DEFAULT 'USER',
    row_status TEXT NOT NULL DEFAULT 'NORMAL',
    created_ts INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_ts INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- 用户设置表
CREATE TABLE user_setting (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    locale TEXT NOT NULL DEFAULT 'zh',
    appearance TEXT NOT NULL DEFAULT 'system',
    memo_visibility TEXT NOT NULL DEFAULT 'PRIVATE',
    created_ts INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_ts INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
);

-- 备忘录表
CREATE TABLE memo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    creator_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'PRIVATE',
    pinned INTEGER NOT NULL DEFAULT 0,
    row_status TEXT NOT NULL DEFAULT 'NORMAL',
    created_ts INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_ts INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (creator_id) REFERENCES user (id) ON DELETE CASCADE
);

CREATE TABLE tag (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    creator_id INTEGER NOT NULL,
    created_ts INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (creator_id) REFERENCES user (id) ON DELETE CASCADE
);

CREATE TABLE memo_tag (
    memo_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (memo_id, tag_id),
    FOREIGN KEY (memo_id) REFERENCES memo (id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tag (id) ON DELETE CASCADE
);

CREATE TABLE resource (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    type TEXT NOT NULL,
    size INTEGER NOT NULL,
    blob BLOB,
    external_link TEXT,
    creator_id INTEGER NOT NULL,
    created_ts INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_ts INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (creator_id) REFERENCES user (id) ON DELETE CASCADE
);


CREATE TABLE memo_resource (
    memo_id INTEGER NOT NULL,
    resource_id INTEGER NOT NULL,
    PRIMARY KEY (memo_id, resource_id),
    FOREIGN KEY (memo_id) REFERENCES memo (id) ON DELETE CASCADE,
    FOREIGN KEY (resource_id) REFERENCES resource (id) ON DELETE CASCADE
);

CREATE INDEX idx_memo_creator_id ON memo (creator_id);
CREATE INDEX idx_memo_created_ts ON memo (created_ts);
CREATE INDEX idx_tag_creator_id ON tag (creator_id);
CREATE INDEX idx_resource_creator_id ON resource (creator_id);
CREATE INDEX idx_user_uid ON user (uid);
CREATE INDEX idx_memo_uid ON memo (uid);
CREATE INDEX idx_resource_uid ON resource (uid);


INSERT INTO user (uid, username, password_hash, nickname, role, row_status) 
VALUES ('admin-uid-12345', 'admin', '$2b$10$9XZw8vPzF6EQRKQJZr8U4OyIo8hC2VL.KKFJJBb8iP4oJm5mZw7Ke', 'Administrator', 'HOST', 'NORMAL');

INSERT INTO memo (uid, creator_id, content, visibility, row_status) 
VALUES ('memo-uid-12345', 1, '欢迎使用 Memos Cloudflare 版本！\n\n这是一个基于 Cloudflare Workers + D1 + R2 的 Memos 部署。\n\n功能特点：\n- 🚀 无服务器架构\n- 💾 D1 数据库存储\n- 📦 R2 对象存储\n- 🔒 JWT 身份验证\n- 🌐 全球边缘部署', 'PUBLIC', 'NORMAL');

-- 插入测试标签
INSERT INTO tag (creator_id, name, created_ts) VALUES (1, '测试', strftime('%s', 'now'));
INSERT INTO tag (creator_id, name, created_ts) VALUES (1, '开发', strftime('%s', 'now'));
INSERT INTO tag (creator_id, name, created_ts) VALUES (1, 'Cloudflare', strftime('%s', 'now'));

-- 插入memo-tag关联
INSERT INTO memo_tag (memo_id, tag_id) VALUES (1, 1);
INSERT INTO memo_tag (memo_id, tag_id) VALUES (1, 2);
INSERT INTO memo_tag (memo_id, tag_id) VALUES (1, 3); 