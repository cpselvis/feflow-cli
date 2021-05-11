import chai from 'chai';
import Report from '../lib/index';
import { getUserName, httpRegex, sshRegex } from '../lib/common/utils';

const expect = chai.expect;

describe('@feflow/report - report', () => {
  let report;

  before(() => {
    report = new Report({ root: '/' });
  });

  it('getUserName() - username is not empty', () => {
    const username = getUserName();

    expect(username).to.not.empty;
  });

  after(() => {
    report = null;
  });
});
