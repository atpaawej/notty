import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initializeRuntime } from "./app-runtime";

// The vault location is known before the first note opens, so attachment
// references can become webview URLs synchronously while the editor renders.
const runtime = await initializeRuntime();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App runtime={runtime} />
  </React.StrictMode>,
);
