import Maze from './Maze.js';

export async function getMazeData(mazeName) {
  try {
    const response = await fetch('/app/maze/get', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ maze: mazeName })
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const data = await response.json();
    return new Maze(data.h, data.v, data.start_x, data.start_y, data.end_x, data.end_y, data.direction);
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

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

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

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (err) {
    console.error('Error sending data: ', err);
    throw err; // propagate error to caller if needed
  }
}
