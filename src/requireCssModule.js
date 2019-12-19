// @flow

import {
  dirname,
  resolve,
  join
} from 'path';
import {
  readFileSync,
  existsSync
} from 'fs';
import postcss from 'postcss';
import genericNames from 'generic-names';
import ExtractImports from 'postcss-modules-extract-imports';
import LocalByDefault from 'postcss-modules-local-by-default';
import Parser from 'postcss-modules-parser';
import Scope from 'postcss-modules-scope';
import Values from 'postcss-modules-values';
import stylus from 'stylus';
import stylusHashPlugin from '@dmapper/stylus-hash-plugin';
import type {
  GenerateScopedNameConfigurationType,
  StyleModuleMapType
} from './types';
import optionsDefaults from './schemas/optionsDefaults';

type FiletypeOptionsType = {|
  +syntax: string,
  +plugins?: $ReadOnlyArray<string | $ReadOnlyArray<[string, mixed]>>
|};

type FiletypesConfigurationType = {
  [key: string]: FiletypeOptionsType
};

type OptionsType = {|
  filetypes: FiletypesConfigurationType,
  generateScopedName?: GenerateScopedNameConfigurationType,
  context?: string
|};

const getFiletypeOptions = (cssSourceFilePath: string, filetypes: FiletypesConfigurationType): ?FiletypeOptionsType => {
  const extension = cssSourceFilePath.substr(cssSourceFilePath.lastIndexOf('.'));
  const filetype = filetypes ? filetypes[extension] : null;

  return filetype;
};

// eslint-disable-next-line flowtype/no-weak-types
const getSyntax = (filetypeOptions: FiletypeOptionsType): ?(Function | Object) => {
  if (!filetypeOptions || !filetypeOptions.syntax) {
    return null;
  }

  // eslint-disable-next-line import/no-dynamic-require, global-require
  return require(filetypeOptions.syntax);
};

// eslint-disable-next-line flowtype/no-weak-types
const getExtraPlugins = (filetypeOptions: ?FiletypeOptionsType): $ReadOnlyArray<*> => {
  if (!filetypeOptions || !filetypeOptions.plugins) {
    return [];
  }

  return filetypeOptions.plugins.map((plugin) => {
    if (Array.isArray(plugin)) {
      const [pluginName, pluginOptions] = plugin;

      // eslint-disable-next-line import/no-dynamic-require, global-require
      return require(pluginName)(pluginOptions);
    }

    // eslint-disable-next-line import/no-dynamic-require, global-require
    return require(plugin);
  });
};

const getTokens = (runner, cssSourceFilePath: string, filetypeOptions: ?FiletypeOptionsType): StyleModuleMapType => {
  // eslint-disable-next-line flowtype/no-weak-types
  const options: Object = {
    from: cssSourceFilePath
  };

  let src = readFileSync(cssSourceFilePath, 'utf-8');

  if (/\.styl$/.test(cssSourceFilePath)) {
    const STYLES_PATH = join(process.cwd(), 'styles/index.styl');
    const CONFIG_PATH = join(process.cwd(), 'startupjs.config.js');
    const compiler = stylus(src);

    compiler.set('filename', cssSourceFilePath);

    // TODO: Make this a setting
    if (existsSync(STYLES_PATH)) {
      compiler.import(STYLES_PATH);
    }

    compiler.define('__WEB__', true);

    if (existsSync(CONFIG_PATH)) {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const {ui} = require(CONFIG_PATH);

      if (ui) {
        compiler.use(stylusHashPlugin('$UI', ui));
      }
    }

    compiler.render((err, res) => {
      if (err) {
        throw new Error(err);
      }
      src = res;
    });
  } else if (filetypeOptions) {
    options.syntax = getSyntax(filetypeOptions);
  }

  const lazyResult = runner
    .process(src, options);

  lazyResult
    .warnings()
    .forEach((message) => {
      // eslint-disable-next-line no-console
      console.warn(message.text);
    });

  return lazyResult.root.tokens;
};

export default (cssSourceFilePath: string, options: OptionsType): StyleModuleMapType => {
  // eslint-disable-next-line prefer-const
  let runner;

  let generateScopedName;

  if (options.generateScopedName && typeof options.generateScopedName === 'function') {
    generateScopedName = options.generateScopedName;
  } else {
    generateScopedName = genericNames(options.generateScopedName || optionsDefaults.generateScopedName, {
      context: options.context || process.cwd()
    });
  }

  const filetypeOptions = getFiletypeOptions(cssSourceFilePath, options.filetypes);

  const fetch = (to: string, from: string) => {
    const fromDirectoryPath = dirname(from);
    const toPath = resolve(fromDirectoryPath, to);

    return getTokens(runner, toPath, filetypeOptions);
  };

  const extraPlugins = getExtraPlugins(filetypeOptions);

  const plugins = [
    ...extraPlugins,
    Values,
    LocalByDefault,
    ExtractImports,
    new Scope({
      generateScopedName
    }),
    new Parser({
      fetch
    })
  ];

  runner = postcss(plugins);

  return getTokens(runner, cssSourceFilePath, filetypeOptions);
};
