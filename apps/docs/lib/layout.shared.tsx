import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="font-semibold tracking-tight">{appName}</span>
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    links: [
      {
        text: 'Quickstart',
        url: '/docs/quickstart',
      },
      {
        text: 'Architecture',
        url: '/docs/architecture',
      },
      {
        text: 'SDKs',
        url: '/docs/sdks',
      },
      {
        text: 'Cookbook',
        url: '/docs/cookbook',
      },
    ],
  };
}
