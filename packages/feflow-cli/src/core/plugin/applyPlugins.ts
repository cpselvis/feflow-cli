import compose from './compose';
import chalk from 'chalk';
import osenv from 'osenv';
import path from 'path';
import { FEFLOW_ROOT, UNIVERSAL_PLUGIN_CONFIG } from '../../shared/constant';
import CommandPickConfig from '../command-picker/pickConfig';
import { COMMAND_TYPE } from "../command-picker";
import logger from '../logger';
import { Plugin } from '../universal-pkg/schema/plugin';
import fs from 'fs';
import { parseYaml } from '../../shared/yaml';

export default function applyPlugins(plugins: any[]) {
  return (ctx: any) => {
    if (!plugins.length) {
      return;
    }
    const pickConfig = new CommandPickConfig(ctx);

    const chain = plugins.map((name: any) => {
      const home = path.join(osenv.home(), FEFLOW_ROOT);
      const pluginPath = path.join(home, 'node_modules', name);
      pickConfig.registSubCommand(COMMAND_TYPE.PLUGIN_TYPE, ctx.commander.store, name);

      try {
        ctx.logger.debug('Plugin loaded: %s', chalk.magenta(name));
        const pluginLogger = logger({
          debug: Boolean(ctx.args.debug),
          silent: Boolean(ctx.args.silent),
          name,
        });
        return require(pluginPath)(Object.assign({}, ctx, {logger: pluginLogger}));
      } catch (err) {
        ctx.fefError.printError({ error: err, msg: 'command load failed: %s', pluginPath });
      }
    });

    compose(...chain);
    pickConfig.registSubCommand(COMMAND_TYPE.PLUGIN_TYPE, ctx.commander.store);
    pickConfig.updateCache(COMMAND_TYPE.PLUGIN_TYPE);
  };
}


export function resolvePlugin(ctx: any, repoPath: string): Plugin {
  const pluginFile = path.join(repoPath, UNIVERSAL_PLUGIN_CONFIG);
  const exists = fs.existsSync(pluginFile);
  if (!exists) {
    throw `the ${UNIVERSAL_PLUGIN_CONFIG} file was not found`;
  }
  let config;
  try {
    config = parseYaml(pluginFile);
  } catch (e) {
    throw `the ${UNIVERSAL_PLUGIN_CONFIG} file failed to resolve, please check the syntax, e: ${e}`;
  }
  return new Plugin(ctx, repoPath, config);
}
