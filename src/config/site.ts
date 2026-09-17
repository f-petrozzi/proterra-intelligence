export const site = {
  name: "Proterra Intelligence",
  initials: "PI",
  descriptor: "Dairy, meat, and bovine genetics",
  description: "Weekly coverage of dairy, meat, and bovine genetics.",
  footerNote: "Reviewed weekly with direct sources.",
  // Also rendered by the Review Worker's subscription pages, so they share the site header.
  nav: [
    { href: "/", label: "Latest" },
    { href: "/archive", label: "Archive" },
    { href: "/history", label: "Dashboard" },
    { href: "/sources", label: "Source review" }
  ]
} as const;
