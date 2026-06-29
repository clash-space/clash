
import { Link } from 'react-router';

const navigation = {
  product: [
    { name: 'Docs', href: '/docs' },
  ],
  company: [
    { name: 'Marketplace', href: '/marketplace' },
    { name: 'Download', href: '/download' },
  ],
  legal: [
    { name: 'Privacy', href: '/privacy' },
    { name: 'Terms', href: '/terms' },
  ],
};

export default function LandingFooter() {
  return (
    <footer className="bg-warm-muted/55 border-t border-warm-border relative z-10" aria-labelledby="footer-heading">
      <h2 id="footer-heading" className="sr-only">
        Footer
      </h2>
      <div className="mx-auto max-w-7xl px-6 py-16 sm:py-24 lg:px-8 lg:py-32">
        <div className="xl:grid xl:grid-cols-3 xl:gap-8">
          <div className="space-y-8">
             <Link to="/" className="group">
              <div className="flex items-center gap-1.5">
                <img
                  src="/brand/logo-mark.svg"
                  alt=""
                  className="h-10 w-10 object-contain"
                  draggable={false}
                />
                <span className="font-display text-lg font-semibold leading-none text-slate-900 dark:text-slate-50">
                  Clash
                </span>
              </div>
            </Link>
            <p className="text-sm leading-6 text-stone-700 dark:text-stone-300">
              Open-source workbench for agent-assisted creation.
            </p>
            <div className="flex space-x-6">
              {/* Social links would go here */}
            </div>
          </div>
          <div className="mt-16 grid grid-cols-2 gap-8 xl:col-span-2 xl:mt-0">
            <div className="md:grid md:grid-cols-2 md:gap-8">
              <div>
                <h3 className="text-sm font-semibold leading-6 text-slate-900 dark:text-slate-50">Resources</h3>
                <ul role="list" className="mt-6 space-y-4">
                  {navigation.product.map((item) => (
                    <li key={item.name}>
                      <Link to={item.href} className="text-sm leading-6 text-stone-700 dark:text-stone-300 hover:text-slate-950">
                        {item.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mt-10 md:mt-0">
                <h3 className="text-sm font-semibold leading-6 text-slate-900 dark:text-slate-50">Company</h3>
                <ul role="list" className="mt-6 space-y-4">
                  {navigation.company.map((item) => (
                    <li key={item.name}>
                      <Link to={item.href} className="text-sm leading-6 text-stone-700 dark:text-stone-300 hover:text-slate-950">
                        {item.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="md:grid md:grid-cols-2 md:gap-8">
              <div>
                <h3 className="text-sm font-semibold leading-6 text-slate-900 dark:text-slate-50">Legal</h3>
                <ul role="list" className="mt-6 space-y-4">
                  {navigation.legal.map((item) => (
                    <li key={item.name}>
                      <Link to={item.href} className="text-sm leading-6 text-stone-700 dark:text-stone-300 hover:text-slate-950">
                        {item.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-16 border-t border-warm-border pt-8 sm:mt-20 lg:mt-24">
          <p className="text-xs leading-5 text-stone-600 dark:text-stone-300">
            &copy; {new Date().getFullYear()} Clash, Inc. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
