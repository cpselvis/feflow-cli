import fs from 'fs';
import path from 'path';
import _ from 'lodash';

import { execPlugin } from '../plugin/loadUniversalPlugin';
import logger from '../logger';
import { UNIVERSAL_MODULES } from '../../shared/constant';
import CommandPickConfig from './pickConfig';

export enum COMMAND_TYPE {
  NATIVE_TYPE = 'native',
  PLUGIN_TYPE = 'plugin',
  INTERNAL_PLUGIN_TYPE = 'devtool',
  UNIVERSAL_PLUGIN_TYPE = 'universal',
  UNKNOWN_TYPE = 'unknown'
}

export const LOAD_PLUGIN = 1 << 0;
export const LOAD_DEVKIT = 1 << 1;
export const LOAD_UNIVERSAL_PLUGIN = 1 << 2;
export const LOAD_ALL = LOAD_PLUGIN | LOAD_DEVKIT | LOAD_UNIVERSAL_PLUGIN;

export class TargetPlugin {
  path: string;
  type: COMMAND_TYPE;
  pkg?: string;
  constructor(type: COMMAND_TYPE, path: string, pkg: string) {
    this.type = type;
    this.path = path;
    this.pkg = pkg;
  }
}

export class NativePlugin extends TargetPlugin {}

export class TargetUniversalPlugin {
  type: COMMAND_TYPE;
  version: string;
  pkg: string;
  constructor(type: COMMAND_TYPE, version: string, pkg: string) {
    this.type = type;
    this.version = version;
    this.pkg = pkg;
  }
}

export default class CommandPicker {
  root: string;
  cmd: string;
  ctx: any;
  isHelp: boolean;
  cacheController: CommandPickConfig;
  SUPPORT_TYPE = [
    COMMAND_TYPE.NATIVE_TYPE,
    COMMAND_TYPE.PLUGIN_TYPE,
    COMMAND_TYPE.UNIVERSAL_PLUGIN_TYPE,
    COMMAND_TYPE.INTERNAL_PLUGIN_TYPE
  ];
  updateType: COMMAND_TYPE | '';

  homeRunCmd = ['help', 'list'];

  constructor(ctx: any, cmd: string = 'help') {
    this.root = ctx.root;
    this.ctx = ctx;
    this.cmd = cmd;
    this.isHelp = cmd === 'help' || ctx.args.h || ctx.args.help;
    this.cacheController = new CommandPickConfig(ctx);
    this.updateType = '';
  }

  loadHelp() {
    this.cmd = 'help';
    this.pickCommand();
  }

  isAvailable() {
    const targetCommand = this.cacheController.getCommandPath(this.cmd);
    const { type } = targetCommand || {};
    let result = false;
    let pathExists = false;

    if (type === COMMAND_TYPE.UNIVERSAL_PLUGIN_TYPE) {
      const { version, pkg } = targetCommand as TargetUniversalPlugin;
      const pkgPath = path.join(this.ctx.universalModules, `${pkg}@${version}`);
      pathExists = fs.existsSync(pkgPath);
      result = !this.isHelp && pathExists && !!version;
    } else if (type === COMMAND_TYPE.PLUGIN_TYPE) {
      const { path } = targetCommand as TargetPlugin;
      const isCachType = this.SUPPORT_TYPE.includes(type);
      pathExists = fs.existsSync(path);
      result = !this.isHelp && pathExists && isCachType;
    } else if (type === COMMAND_TYPE.NATIVE_TYPE) {
      if (!this.homeRunCmd.includes(this.cmd)) {
        const { path } = targetCommand as NativePlugin;
        pathExists = fs.existsSync(path);
        result = true && pathExists;
      }
    }
    // TODO load internal plugin

    if (!pathExists && this.SUPPORT_TYPE.includes(type)) {
      this.updateType = type;
    }

    return result;
  }

  updateCache() {
    if (this.updateType) {
      this.cacheController.updateCache(this.updateType);
      this.ctx.logger.debug(`update ${this.updateType} cache`);
      this.updateType = '';
    }
  }

  checkCommand() {
    const fn = this.ctx?.commander.get(this.cmd);
    if (!fn) {
      this.loadHelp();
    }
  }

  getCommandSource(path: string): string {
    let reg = /node_modules\/(.*)/;
    const commandSource = (reg.exec(path) || [])[1];
    return commandSource;
  }

  pickCommand() {
    const targetCommand = this.cacheController.getCommandPath(this.cmd);
    const { type } = targetCommand;
    const pluginLogger = logger({
      debug: Boolean(this.ctx.args.debug),
      silent: Boolean(this.ctx.args.silent),
      name: targetCommand.pkg
    });
    this.ctx.logger.debug('pick command type: ', type);
    if (!this.SUPPORT_TYPE.includes(type)) {
      return this.ctx.logger.warn(
        `this kind of command is not supported in command picker, ${type}`
      );
    }
    if (type === COMMAND_TYPE.UNIVERSAL_PLUGIN_TYPE) {
      const { version, pkg } = targetCommand as TargetUniversalPlugin;
      execPlugin(
        Object.assign({}, this.ctx, { logger: pluginLogger }),
        pkg,
        version
      );
    } else {
      const { path } = targetCommand as TargetPlugin;
      const commandSource =
        this.getCommandSource(path) || COMMAND_TYPE.NATIVE_TYPE;
      this.ctx.logger.debug('pick command path: ', path);
      this.ctx.logger.debug('pick command source: ', commandSource);

      try {
        this.ctx?.reporter?.setCommandSource(commandSource);
        require(path)(Object.assign({}, this.ctx, { logger: pluginLogger }));
      } catch (error) {
        this.ctx.fefError.printError(error, 'command load failed: %s');
      }
    }
  }

  getCmdInfo(): { path: string; type: COMMAND_TYPE } {
    const cmdInfo: { path: string; type: COMMAND_TYPE } = {
      type: COMMAND_TYPE.NATIVE_TYPE,
      path: ''
    };
    const targetCommand = this.cacheController.getCommandPath(this.cmd);
    if (!targetCommand) {
      return cmdInfo;
    }
    const { type } = targetCommand;

    if (type === COMMAND_TYPE.PLUGIN_TYPE) {
      cmdInfo.path = (targetCommand as TargetPlugin).path;
    } else if (type === COMMAND_TYPE.UNIVERSAL_PLUGIN_TYPE) {
      const { pkg, version } = targetCommand as TargetUniversalPlugin;
      cmdInfo.path = path.join(
        this.ctx.root,
        UNIVERSAL_MODULES,
        `${pkg}@${version}`
      );
    } else {
      cmdInfo.path = this.ctx.root;
    }

    return cmdInfo;
  }

  getLoadOrder() {
    return LOAD_ALL;
  }
}
