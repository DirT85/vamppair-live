import { initBotId } from "botid/client/core";
import { PROTECTED_API_ROUTES } from "@/lib/botid-routes";

initBotId({
  protect: [...PROTECTED_API_ROUTES],
});
