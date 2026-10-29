-- Maze database schema.
--
-- Table names are singular. `user`.user_id is the primary key, and the
-- same column name is the foreign key in `session` and `maze`.
--
-- `maze` stores named mazes. `h` and `v` are JSON-encoded arrays of
-- wall segments (horizontal / vertical), produced by the editor and
-- consumed by the game. `direction` is the player's start direction:
-- one of 'e', 'n', 'w', 's'. `maze`.user_id is the maze's owner
-- (NULL for mazes created before SSO; the designated owner claims
-- them on first sign-in). Existing deployments get the new tables and
-- column from the startup migration in server/maze.js instead.
--
-- Run against the maze database, e.g.:
--   mysql -h <host> -u <user> -p <database> < schema.sql

CREATE TABLE IF NOT EXISTS maze (
  name      VARCHAR(255) NOT NULL,
  h         LONGTEXT     NOT NULL,
  v         LONGTEXT     NOT NULL,
  start_x   INT          NOT NULL,
  start_y   INT          NOT NULL,
  end_x     INT          NOT NULL,
  end_y     INT          NOT NULL,
  direction CHAR(1)      NOT NULL,
  user_id   INT          NULL,
  PRIMARY KEY (name)
);

CREATE TABLE IF NOT EXISTS user (
  user_id      INT AUTO_INCREMENT PRIMARY KEY,
  sub          VARCHAR(255) NOT NULL UNIQUE,
  email        VARCHAR(255),
  name         VARCHAR(255),
  picture      VARCHAR(512),
  avatar_color VARCHAR(7)   NOT NULL DEFAULT '#22c55e',
  created_at   DATETIME     NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  token_hash CHAR(64) PRIMARY KEY,
  user_id    INT      NOT NULL,
  created_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  INDEX (user_id)
);
