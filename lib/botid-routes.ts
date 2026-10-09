const basicProtection = { checkLevel: "basic" as const };

export const PROTECTED_API_ROUTES = [
  { path: "/api/coin/*", method: "GET", advancedOptions: basicProtection },
  { path: "/api/metadata", method: "POST", advancedOptions: basicProtection },
  { path: "/api/launch/build", method: "POST", advancedOptions: basicProtection },
  { path: "/api/launch/send", method: "POST", advancedOptions: basicProtection },
  { path: "/api/launch/buy/build", method: "POST", advancedOptions: basicProtection },
  { path: "/api/launch/confirm", method: "POST", advancedOptions: basicProtection },
  { path: "/api/portfolio", method: "POST", advancedOptions: basicProtection },
] as const;
