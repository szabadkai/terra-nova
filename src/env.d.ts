/** the build this page was made from (the commit's short hash, set by vite.config.ts), so two machines can tell they run the same game */
declare const __BUILD__: string;
/** a module run as a Web Worker, bundled into the page (Vite's `?worker&inline`) */
declare module '*?worker&inline' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}
