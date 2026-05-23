import { createRoot } from "react-dom/client";

import App from "./App.js";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Dashboard root element not found.");
}

document.documentElement.classList.add("dark");
document.documentElement.style.colorScheme = "dark";

createRoot(rootElement).render(<App />);