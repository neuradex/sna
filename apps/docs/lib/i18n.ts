import { defineI18nUI } from 'fumadocs-ui/i18n';
import type { I18nConfig } from 'fumadocs-core/i18n';

const i18nConfig: I18nConfig = {
  defaultLanguage: 'en',
  languages: ['en', 'ko', 'ja'],
  hideLocale: 'default-locale',
};

const ui = defineI18nUI(i18nConfig, {
  en: { displayName: 'English' },
  ko: {
    displayName: '한국어',
    search: '문서 검색',
    nextPage: '다음 페이지',
    previousPage: '이전 페이지',
    chooseTheme: '테마 선택',
    chooseLanguage: '언어 선택',
    toc: '목차',
    tocNoHeadings: '제목 없음',
    lastUpdate: '마지막 업데이트',
    editOnGithub: 'GitHub에서 편집',
  },
  ja: {
    displayName: '日本語',
    search: 'ドキュメント検索',
    nextPage: '次のページ',
    previousPage: '前のページ',
    chooseTheme: 'テーマを選択',
    chooseLanguage: '言語を選択',
    toc: '目次',
    tocNoHeadings: '見出しなし',
    lastUpdate: '最終更新',
    editOnGithub: 'GitHub で編集',
  },
});

export const i18n = ui;
export const localeNames: Record<string, string> = {
  en: 'English',
  ko: '한국어',
  ja: '日本語',
};
