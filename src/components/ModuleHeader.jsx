// Shared markup and existing system tokens: no module-specific gradient/height.
export default function ModuleHeader({ icon, kicker, title, subtitle, children }) {
  return <header className="printshop-topbar digital-signage-header">
    <div className="printshop-topbar-main">
      <span className="printshop-topbar-module-icon">{icon}</span>
      <div className="printshop-topbar-copy">
        <p className="section-kicker printshop-kicker">{kicker}</p>
        <h1>{title}</h1><p>{subtitle}</p>
      </div>
    </div>
    {children && <section className="printshop-hero-actions ac-console-actions">{children}</section>}
  </header>;
}
