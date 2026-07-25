import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "@fontsource-variable/source-serif-4/wght.css";
import "@fontsource-variable/source-sans-3/wght.css";
import App from "./App";
import "flatpickr/dist/flatpickr.min.css";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("Không tìm thấy phần tử #root.");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
