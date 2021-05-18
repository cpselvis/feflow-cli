import ApiController from './api/index';
import { getUserName, getSystemInfo, getKeyFormFile, setKeyToFile } from './common/utils';
import objectFactory from './common/objectFactory';
import { REPORT_STATUS } from './constants';

const {
  cmd,
  args,
  commandSource,
  lastCommand,
  project,
  version,
  generatorProject,
  cachePath,
  costTime,
  recall,
} = process.env;
const params = JSON.parse(args);
const userName = getUserName();
const systemInfo = getSystemInfo();

function getReportBody(cmd, params): any {
  return objectFactory
    .create()
    .load('command', cmd)
    .load('last_command', lastCommand)
    .load('feflow_version', version)
    .load('command_source', commandSource)
    .load('user_name', userName)
    .load('params', params)
    .load('err_message', getKeyFormFile(cachePath, 'errMsg'))
    .load('system_info', systemInfo)
    .load('project', project)
    .load('status', REPORT_STATUS.START)
    .load('node_version', process.version)
    .done();
}

function getRecallBody(): any {
  return objectFactory
    .create()
    .load('command')
    .load('generator_project', generatorProject)
    .load('recall_id', getKeyFormFile(cachePath, 'recallId'))
    .load('cost_time', costTime)
    .load('err_message', getKeyFormFile(cachePath, 'errMsg'))
    .load('is_fail', false)
    .load('status', REPORT_STATUS.COMPLETED)
    .done();
}

function recallReport(): any {
  setKeyToFile(cachePath, 'isRecallActivating', true);
  if (!getKeyFormFile(cachePath, 'recallId')) return;
  try {
    const reCallBody: RecallBody = getRecallBody();
    console.log('reCallBody', JSON.stringify(reCallBody));

    const report = new ApiController(reCallBody, { info: console.log, debug: console.log });
    report.doReport();
    setKeyToFile(cachePath, 'hasRecalled', true);
  } catch (error) {
    console.log('feflow recallReport got error，please contact administractor to resolve ', error);
  }
}

function startReport(): any {
  if (String(recall) === 'true') return recallReport();

  try {
    const reportBody: ReportBody = getReportBody(cmd, params);
    console.log('reportBody', JSON.stringify(reportBody));

    const report = new ApiController(reportBody, { info: console.log, debug: console.log });
    report.doReport(({ result }) => {
      if (getKeyFormFile(cachePath, 'errMsg')) return;
      const { id } = result || {};
      setKeyToFile(cachePath, 'reCallId', id);
      // hack async
      if (getKeyFormFile(cachePath, 'isRecallActivating')) {
        recallReport();
      }
    });
  } catch (error) {
    console.debug('feflow report got error，please contact administractor to resolve ', error);
  }
}

startReport();
