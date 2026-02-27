// src/router.tsx
import { createBrowserRouter } from "react-router-dom";
import AppLayout from "./components/appLayout";
import Landing from "./pages/landing";
import Signup from "./pages/signup";
import Login from "./pages/login";
import Dashboard from "./pages/dashboard";

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: "/", element: <Landing /> },
      { path: "/signup", element: <Signup /> },
      { path: "/login", element: <Login /> },
      { path: "/dashboard", element: <Dashboard /> },
    ],
  },
]);