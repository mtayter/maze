-- Maze database schema.
--
-- The table stores named mazes. `h` and `v` are JSON-encoded arrays of
-- wall segments (horizontal / vertical), produced by the editor
-- (public/draw.html) and consumed by the game (public/maze.html).
-- `direction` is the player's start direction: one of 'e', 'n', 'w', 's'.
-- Column types are inferred from the queries in server/maze.js.
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
  PRIMARY KEY (name)
);
