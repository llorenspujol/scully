// tslint:disable-next-line: ordered-imports
import '@angular/platform-server/init';
import { DOCUMENT } from '@angular/common';
import { ResourceLoader } from '@angular/compiler';
import { APP_INITIALIZER, StaticProvider } from '@angular/core';
import { INITIAL_CONFIG, renderModule } from '@angular/platform-server';
import {
  findPlugin,
  HandledRoute,
  loadConfig,
  registerPlugin,
  renderRoute,
  scullyConfig,
  ScullyConfig,
  startWorkerListener,
  Tasks,
  WriteToStorage
} from '@scullyio/scully';
import { readFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { URL } from 'url';
import { version } from 'yargs';

// tslint:disable-next-line: ordered-imports
import 'zone.js/node';
// tslint:disable-next-line: ordered-imports
import 'zone.js/dist/task-tracking';



let config: Promise<ScullyConfig>;
const globalSetup: {
  rawHtml?: string;
} = {};
const executePluginsForRoute = findPlugin(renderRoute);
const writeToFs = findPlugin(WriteToStorage);
const universalRenderRunner = ('universalRender_runner');

async function init(path) {
  const extraProviders: StaticProvider[] = [
    { provide: APP_INITIALIZER, multi: true, useFactory: domContentLoadedFactory, deps: [DOCUMENT] },
  ];
  const { config: myConfig } = await import(path);
  config = loadConfig(await myConfig);

  const lazymodule = await import('../../apps/universal-sample/src/app/app.universal.module');
  const { default: userModule } = lazymodule

  globalSetup.rawHtml = readFileSync(join(process.cwd(), './dist/apps/universal-sample/index.html')).toString('utf-8');

  async function universalRenderPlugin(route: HandledRoute) {
    await config;
    try {
      const baseUrl = `http://localhost:1864`
      const url = `${baseUrl}${route.route}`;
      const window: Partial<Window> = {
        dispatchEvent: (...x: any[]) => undefined,
        location: (new URL(url) as unknown) as Location,
      };
      globalThis.window = window as Window & typeof globalThis;
      const options = {
        url,
        document: globalSetup.rawHtml,
        baseUrl,

      };
      window['scullyVersion'] = version;
      window['ScullyIO-exposed'] = undefined;
      window['ScullyIO-injected'] = undefined;
      if (route.config && route.config.manualIdleCheck) {
        route.exposeToPage = route.exposeToPage || {};
        route.exposeToPage.manualIdle = true;
      }

      if (scullyConfig.inlineStateOnly) {
        route.injectToPage = route.injectToPage || {};
        route.injectToPage.inlineStateOnly = true;
      }

      if (route.exposeToPage !== undefined) {
        window['ScullyIO-exposed'] = route.exposeToPage;
      }
      if (route.injectToPage !== undefined) {
        window['ScullyIO-injected'] = route.injectToPage;
      }
      window['ScullyIO'] = 'running';

      // const routeProviders = [...extraProviders, { provide: INITIAL_CONFIG, useValue: options }];

      const result = await renderModule(userModule, {
        extraProviders,
        ...options
      }).catch(e => {
        return `Error while rendering: ${e}`
      });
      return result;
    } catch (e) {
      console.log(e);
      return `Error while rendering: ${e}`
    }
    return 'oops';
  }
  registerPlugin('scullySystem', universalRenderRunner, universalRenderPlugin);
  return 'init done ' + process.pid;
}

class FileLoader implements ResourceLoader {
  get(url: string): Promise<string> {
    return readFile(url, 'utf-8');
  }
}

if (typeof process.send === 'function') {
  const availableTasks: Tasks = {
    init,
    render: async (ev: HandledRoute) => {
      try {
        ev.renderPlugin = universalRenderRunner;
        const html = await executePluginsForRoute(ev);
        await writeToFs(ev.route, html);
      } catch (e) {
        console.error(e)
        process.exit(15)
      }
    },
  } as const;

  startWorkerListener(availableTasks);
}

export function domContentLoadedFactory(doc: Document): () => Promise<void> {
  return () =>
    new Promise((resolve, _reject) => {
      if (doc.readyState === 'complete' || doc.readyState === 'interactive') {
        resolve();

        return;
      }

      const contentLoaded = () => {
        doc.removeEventListener('DOMContentLoaded', contentLoaded);
        resolve();
      };

      doc.addEventListener('DOMContentLoaded', contentLoaded);
    });
}
