import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, gitConfig } from './shared';

export function baseOptions(lang?: string): BaseLayoutProps {
  return {
    i18n: true,
    nav: {
      title: (
        <span className="font-semibold tracking-tight">{appName}</span>
      ),
      url: lang ? `/${lang}` : '/',
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
