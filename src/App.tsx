// src/app.tsx
import { RouterProvider } from "react-router-dom";
import { router } from "./router";

export default function App() {
  // keep your providers here if you have them
  return <RouterProvider router={router} />;
}