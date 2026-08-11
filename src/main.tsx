import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConsoleApp } from "./ConsoleApp";
import "./styles.css";

const root = document.getElementById("root");

if (!root) throw new Error("Application root element was not found.");

createRoot(root).render(
  <StrictMode>
    <ConsoleApp />
  </StrictMode>,
);
