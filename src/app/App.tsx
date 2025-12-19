import { RouterProvider } from "react-router-dom";
import { router } from "@/app/routes";
import { AudioReactiveBackground } from "@/shared/ui/AudioReactiveBackground";

export function App() {
  return (
    <>
      <AudioReactiveBackground />
      <RouterProvider router={router} />
    </>
  );
}
