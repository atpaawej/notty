import { createRoot } from "react-dom/client";
import { Site } from "./modules/site";

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(<Site />);
}
