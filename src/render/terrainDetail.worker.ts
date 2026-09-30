// Paint one layer at a time; transfer its buffers without copying them between threads.
import { generateDetailLayer } from './terrainDetailData';

self.onmessage = (e: MessageEvent<number>) => {
  const data = generateDetailLayer(e.data);
  postMessage(data, { transfer: [data.albedo.buffer, data.normal.buffer] });
};
