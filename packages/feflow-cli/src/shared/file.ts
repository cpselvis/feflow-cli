import fs from 'fs';
import path from 'path';
import importFresh from 'import-fresh';
import stripComments from 'strip-json-comments';
import yaml from 'js-yaml';

/*
 * @description 保证文件一定存在，文件不存在则创建文件
 * @param filePath 文件路径
 * */
export function fileExit(filePath: string) {
  try {
    fs.readFileSync(filePath, 'utf-8');
  } catch (_) {
    fs.appendFileSync(filePath, '', 'utf-8');
  }
}
// 文件中读取json对象的某个value
export const getKeyFormFile = (file: string, key: string) => {
  try {
    const jsonString = fs.readFileSync(file, 'utf-8');
    if (jsonString) {
      const jsonData = JSON.parse(jsonString);
      return jsonData[key];
    } else {
      return '';
    }
  } catch (e) {
    console.log('getKeyFormCache error =>', e);
  }
};
// 文件中写入一个json字符串
export const setKeyToFile = (file: string, key: string, value: any): any => {
  try {
    const jsonString = fs.readFileSync(file, 'utf-8');
    let jsonData;
    if (jsonString) {
      jsonData = JSON.parse(jsonString);
      jsonData[key] = value;
    } else {
      jsonData = {
        [key]: value
      };
    }
    fs.writeFileSync(file, JSON.stringify(jsonData, null, 4), 'utf-8');
  } catch (e) {
    console.log('setKeyToCache error =>', e);
  }
};


export class Config {
  static loadConfigFile(filePath: string) {
    switch (path.extname(filePath)) {
      case '.js':
        return Config.loadJSConfigFile(filePath);

      case '.json':
        if (path.basename(filePath) === 'package.json') {
          return Config.loadPackageJSONConfigFile(filePath);
        }
        return Config.loadJSONConfigFile(filePath);

      case '.yaml':
      case '.yml':
        return Config.loadYAMLConfigFile(filePath);

      default:
        return Config.loadLegacyConfigFile(filePath);
    }
  }

  static loadJSConfigFile(filePath: string) {
    try {
      return importFresh(filePath);
    } catch (e) {
      e.message = `Cannot read config file: ${filePath}\nError: ${e.message}`;
      throw e;
    }
  }

  static loadPackageJSONConfigFile(filePath: string) {
    try {
      return Config.loadJSONConfigFile(filePath);;
    } catch (e) {
      e.message = `Cannot read config file: ${filePath}\nError: ${e.message}`;
      throw e;
    }
  }

  static loadJSONConfigFile(filePath: string) {
    try {
      return JSON.parse(stripComments(Config.readFile(filePath)));
    } catch (e) {
      e.message = `Cannot read config file: ${filePath}\nError: ${e.message}`;
      e.messageTemplate = 'failed-to-read-json';
      e.messageData = {
        path: filePath,
        message: e.message
      };
      throw e;
    }
  }

  static readFile(filePath: string) {
    return fs.readFileSync(filePath, 'utf8').replace(/^\ufeff/u, '');
  }

  static loadYAMLConfigFile(filePath: string) {
    try {
      return yaml.safeLoad(Config.readFile(filePath)) || {};
    } catch (e) {
      e.message = `Cannot read config file: ${filePath}\nError: ${e.message}`;
      throw e;
    }
  }

  static loadLegacyConfigFile(filePath: string) {
    try {
      return yaml.safeLoad(stripComments(this.readFile(filePath))) || {};
    } catch (e) {
      e.message = `Cannot read config file: ${filePath}\nError: ${e.message}`;
      throw e;
    }
  }
}
