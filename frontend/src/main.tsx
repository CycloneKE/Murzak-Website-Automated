import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import '@fontsource-variable/manrope';
import '@fontsource-variable/jetbrains-mono';
import './index.css';
import { setupApiInterceptor } from "./services/apiInterceptor";
import { setupGlobalErrorReporting } from "./services/clientLog";
import { ThemeProvider } from "./context/ThemeContext";

setupApiInterceptor();
setupGlobalErrorReporting();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
