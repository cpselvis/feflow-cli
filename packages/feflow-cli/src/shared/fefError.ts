import { existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { get } from 'lodash';

import Feflow from '../core';
import { Config } from '../shared/file';
import CommandPicker, { COMMAND_TYPE } from '../core/command-picker';

type PrintError = {
  error: any | Error;
  msg: string;
  pluginPath?: string;
  hideError?: boolean;
};

// 不用强制中断流程
export class FefError {
  context: Feflow;
  picker: CommandPicker | null;

  defaultDocs = 'https://github.com/Tencent/feflow/issues';
  docsPathList = ['docs', 'doc', 'bugs.url', 'repository.url'];
  pluginFile = 'package.json';
  unversalpluginFile = ['plugin.yaml', 'plugin.yml'];

  constructor(context: Feflow) {
    this.context = context;
    // 区分npm插件和多语言插件
    // npm插件 => package.json
    // 多语言插件 => plugin.yaml
    if (this.context.commandPick) {
      this.picker = context.commandPick as CommandPicker;
    } else {
      this.picker = null;
      // throw new Error('command pick is not inital');
      context.logger.debug('command pick is not inital');
    }
  }

  checkPick() {
    if (this.picker) return true;
    if (this.context.commandPick) {
      this.picker = this.context.commandPick as CommandPicker;
    }
    return !!this.picker;
  }

  printError(obj: PrintError) {
    let { pluginPath } = obj;
    if (!pluginPath) {
      if (!this.checkPick()) {
        this.context.logger.debug('无法找到命令路径');
      } else {
        this.context.logger.debug('FefError command pick 初始化成功');
      }
    }

    const docs = this.getDocPath(pluginPath);
    if (docs) {
      this.printErrorWithDocs(obj, docs);
    }
  }

  printErrorWithDocs(obj: PrintError, docs: string) {
    let { error, msg } = obj;
    if (!obj.hideError) {
      msg = `${msg || error} 
      插件执行发生异常，请查看文档获取更多内容：${chalk.green(docs)}`;
      this.context.logger.error({ err: error }, msg, chalk.magenta(error));
    } else {
      // 兼容多语言插件
      msg = `${msg} 请查看文档获取更多内容：${chalk.green(docs)}`;
      this.context.logger.debug(msg);
    }
  }

  getDocPath(pluginPath?: string) {
    let docs = '';
    let configPath = '';
    let type = COMMAND_TYPE.PLUGIN_TYPE;
    if (!pluginPath) {
      if (this.picker != null) {
        const { path, type: cmdType } = this.picker.getCmdInfo();
        pluginPath = path;
        type = cmdType;
      } else {
        return docs;
      }
    }

    if (!pluginPath || !existsSync(pluginPath)) {
      return docs;
    }
    if (type === COMMAND_TYPE.PLUGIN_TYPE) {
      configPath = join(pluginPath, this.pluginFile);
    } else if (type === COMMAND_TYPE.UNIVERSAL_PLUGIN_TYPE) {
      this.unversalpluginFile.forEach((ext) => {
        let tmpPath = join(pluginPath as string, ext);
        if (existsSync(tmpPath)) configPath = tmpPath;
      });
    } else if (type === COMMAND_TYPE.NATIVE_TYPE) {
      return this.defaultDocs;
    }

    if (existsSync(configPath)) {
      const config = this.parseConfig(configPath);
      this.docsPathList.forEach((docsPath) => {
        if (docs) return;
        docs = get(config, docsPath);
      });
    } else {
      this.context.logger.info(`未找到插件配置文件: ${pluginPath}`);
    }

    return docs;
  }

  parseConfig(filePath: string) {
    return Config.loadConfigFile(filePath);
  }
}
