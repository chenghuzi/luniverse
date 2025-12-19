import { createBrowserRouter } from "react-router-dom";
import { DeckPage } from "@/pages/DeckPage";
import { DetailPage } from "@/pages/DetailPage";

export const router = createBrowserRouter([
  { path: "/", element: <DeckPage /> },
  { path: "/detail/:cardInstanceId", element: <DetailPage /> },
]);
