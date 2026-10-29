import Maze from './Maze.js?v=4.0.1';

// The API gates everything behind the session cookie. A 401 means the
// session is gone: tell the shell (Auth listens for this) and fail the
// call with err.status set, so callers can distinguish error kinds.
function checkResponse(response) {
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('maze-unauthorized'));
  }
  if (!response.ok) {
    const err = new Error(`Request failed with status ${response.status}`);
    err.status = response.status;
    throw err;
  }
}

export async function getMazeData(mazeName) {
  try {
    const response = await fetch('/app/maze/get', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ maze: mazeName })
    });

    checkResponse(response);

    const data = await response.json();
    const maze = new Maze(data.h, data.v, data.start_x, data.start_y, data.end_x, data.end_y, data.direction);
    maze.owner_name = data.owner_name;
    maze.mine = data.mine;
    return maze;
  } catch (err) {
    console.error('Error sending data: ', err);
    throw err; // propagate error to caller if needed
  }
}

// The maze list is memoized for the session so SPA view switches can
// restore the picker instantly; saveMazeData invalidates the cache.
let listCache = null;

export async function listMazes() {
  if (!listCache) {
    listCache = (async () => {
      try {
        const response = await fetch('/app/maze/list', {
          method: 'GET'
        });

        checkResponse(response);

        return await response.json();
      } catch (err) {
        listCache = null;
        console.error('Error sending data: ', err);
        throw err; // propagate error to caller if needed
      }
    })();
  }
  return listCache;
}

export async function saveMazeData(mazeName, h, v, start_x, start_y, end_x, end_y, direction) {
  listCache = null;
  try {
    const response = await fetch('/app/maze/save', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ maze: mazeName,
                             h: h,
                             v: v,
                             start_x: start_x,
                             start_y: start_y,
                             end_x: end_x,
                             end_y: end_y,
                             direction: direction })
    });

    checkResponse(response);

    const data = await response.json();
    return data;
  } catch (err) {
    console.error('Error sending data: ', err);
    throw err; // propagate error to caller if needed
  }
}
