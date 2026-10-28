import "@github/relative-time-element";
import { CssVarsProvider } from "@mui/joy";
import { observer } from "mobx-react-lite";
import { createRoot } from "react-dom/client";
import { Toaster } from "react-hot-toast";
import { RouterProvider } from "react-router-dom";
import "./i18n";
import router from "./router";
import { initialUserStore } from "./store/v2/user";
import { initialWorkspaceStore } from "./store/v2/workspace";
import "./style.css";
import theme from "./theme";
import "@usememos/mui/dist/index.css";

// Version identification for deployment debugging
const BUILD_VERSION = "v2025-07-11-13:12:00";
const BUILD_COMMIT = "3bb4fd6";
console.log(`🚀 Memos Frontend ${BUILD_VERSION} (${BUILD_COMMIT})`);
console.log(`📅 Build Time: ${new Date().toISOString()}`);

const Main = observer(() => (
  <CssVarsProvider theme={theme}>
    <RouterProvider router={router} />
    <Toaster position="top-right" toastOptions={{ className: "dark:bg-zinc-700 dark:text-gray-300" }} />
  </CssVarsProvider>
));

(async () => {
  // A rejected store initializer used to abort before root.render() was ever
  // called, leaving the user with a permanently blank page and no way back.
  // The app degrades fine on defaults, so log and render regardless.
  try {
    await initialWorkspaceStore();
    await initialUserStore();
  } catch (error) {
    console.error("Failed to initialize stores, continuing with defaults:", error);
  }

  const container = document.getElementById("root");
  const root = createRoot(container as HTMLElement);
  root.render(<Main />);
})();
