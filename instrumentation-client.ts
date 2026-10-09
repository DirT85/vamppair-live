import { initBotId } from "botid/client/core";

const basicProtection = { checkLevel: "basic" as const };

initBotId({
  protect: [
    {
      path: "/api/coin/*",
      method: "GET",
      advancedOptions: basicProtection,
    },
    {
      path: "/api/metadata",
      method: "POST",
      advancedOptions: basicProtection,
    },
    {
      path: "/api/launch/build",
      method: "POST",
      advancedOptions: basicProtection,
    },
    {
      path: "/api/launch/send",
      method: "POST",
      advancedOptions: basicProtection,
    },
    {
      path: "/api/portfolio",
      method: "POST",
      advancedOptions: basicProtection,
    },
  ],
});
