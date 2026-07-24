import {
  IndustryPackDefinition,
  IndustryPackId,
  OfficeActionCard,
  OfficeTemplateCatalog,
  OfficeTemplateDefinition,
  OfficeTemplateSlot,
  RewriteScenario,
  TemplateSlotCheck,
} from './types';

const ALL_INDUSTRIES: IndustryPackId[] = [
  'general_office', 'political_legal', 'public_security', 'prison', 'court', 'procuratorate',
  'judicial_administration', 'government', 'education', 'medical', 'finance', 'banking',
  'insurance', 'real_estate', 'property_management', 'ecommerce', 'customer_service', 'sales',
  'manufacturing', 'logistics', 'catering', 'live_streaming', 'local_services', 'law_firm',
  'tax_accounting', 'human_resources', 'administration', 'project_management',
  'software_development', 'product_management', 'design', 'procurement', 'bidding',
];

const COMMON_PROHIBITED = ['不得编造时间、人员、金额或结论', '不得遗漏原文中的关键事实', '缺少必要信息时标记“待补充”'];
export const COMMON_OFFICE_TERMS = [
  '责任人', '完成时限', '工作要求', '风险点', '下一步', '会议纪要', '情况说明', '工作台账',
  '闭环管理', '任务清单', '进度跟踪', '问题整改', '审批流程', '归档材料', '联系人', '附件',
  '工作方案', '实施计划', '反馈意见', '复盘总结',
];

interface TemplateSpec {
  id: RewriteScenario;
  name: string;
  group: string;
  sections: string[];
  required?: OfficeTemplateSlot[];
  optional?: OfficeTemplateSlot[];
  description?: string;
  tone?: string;
  // 行业专属文书只声明它真正适用的行业；其余模板保持全行业通用。
  industries?: IndustryPackId[];
  prohibited?: string[];
}

function createTemplate(spec: TemplateSpec): OfficeTemplateDefinition {
  return {
    id: spec.id,
    name: spec.name,
    group: spec.group,
    description: spec.description ?? `将口述内容整理为${spec.name}，保留全部事实并突出可执行信息。`,
    output_sections: spec.sections,
    required_slots: spec.required ?? ['matter'],
    optional_slots: spec.optional ?? ['time', 'owner', 'deadline', 'risk'],
    industry_packs: spec.industries ?? ALL_INDUSTRIES,
    tone: spec.tone ?? '清晰、准确、简洁、适合直接办公使用',
    prohibited: spec.prohibited ?? COMMON_PROHIBITED,
    example_input: `请把下面口述整理成${spec.name}，不确定的信息留待补充。`,
    example_output: `${spec.sections.map((section) => `${section}：待根据口述内容生成`).join('\n')}`,
  };
}

const TEMPLATE_SPECS: TemplateSpec[] = [
  { id: 'general', name: '通用整理', group: '常用润写', sections: ['整理正文'] },
  { id: 'meeting_notes', name: '会议纪要', group: '常用润写', sections: ['会议主题', '讨论要点', '议定事项', '待办与责任人', '风险与后续'], required: ['matter'], optional: ['time', 'location', 'owner', 'deadline', 'risk'] },
  { id: 'work_report', name: '工作汇报', group: '常用润写', sections: ['工作概况', '进展与成果', '问题与风险', '下一步计划', '需协调事项'] },
  { id: 'message_reply', name: '邮件/微信回复', group: '常用润写', sections: ['回复正文'], required: ['matter', 'audience'], optional: ['time', 'deadline', 'contact'] },
  { id: 'todo_list', name: '待办清单', group: '常用润写', sections: ['待办事项', '责任人', '完成时限', '优先级'], optional: ['owner', 'deadline', 'risk'] },
  { id: 'study_notes', name: '学习笔记', group: '常用润写', sections: ['主题', '核心知识', '案例', '总结'] },
  { id: 'customer_service', name: '客服记录', group: '常用润写', sections: ['客户诉求', '事实记录', '处理过程', '处理结果', '后续跟进'], required: ['matter'], optional: ['time', 'owner', 'result', 'risk'] },
  { id: 'official_resolution', name: '决议', group: '党政机关公文', sections: ['会议事项', '决议内容', '执行要求'] },
  { id: 'official_decision', name: '决定', group: '党政机关公文', sections: ['决定依据', '决定事项', '执行要求'], optional: ['basis', 'owner', 'deadline'] },
  { id: 'official_order', name: '命令（令）', group: '党政机关公文', sections: ['发布事项', '执行范围', '生效要求'], tone: '庄重、权威、明确' },
  { id: 'official_communique', name: '公报', group: '党政机关公文', sections: ['重要事项', '主要数据', '正式结论'] },
  { id: 'official_announcement', name: '公告', group: '党政机关公文', sections: ['公告事项', '适用范围', '有关要求'] },
  { id: 'official_public_notice', name: '通告', group: '党政机关公文', sections: ['通告事项', '执行范围', '时间地点', '有关要求'], optional: ['time', 'location', 'contact'] },
  { id: 'official_opinion', name: '意见', group: '党政机关公文', sections: ['总体要求', '主要任务', '保障措施'] },
  { id: 'official_notice', name: '通知', group: '党政机关公文', sections: ['通知对象', '通知事项', '时间地点', '工作要求', '联系方式'], required: ['audience', 'matter'], optional: ['time', 'location', 'owner', 'deadline', 'contact'] },
  { id: 'official_circular', name: '通报', group: '党政机关公文', sections: ['基本情况', '评价与问题', '工作要求'] },
  { id: 'official_report', name: '报告', group: '党政机关公文', sections: ['基本情况', '主要工作', '问题分析', '下一步安排'] },
  { id: 'official_request', name: '请示', group: '党政机关公文', sections: ['请示缘由', '政策依据', '请示事项', '妥否请批示'], required: ['matter'], optional: ['basis', 'deadline'] },
  { id: 'official_reply', name: '批复', group: '党政机关公文', sections: ['来文事项', '批复意见', '执行要求'], required: ['matter', 'result'], optional: ['basis', 'deadline'] },
  { id: 'official_proposal', name: '议案', group: '党政机关公文', sections: ['提出背景', '依据', '议案事项', '审议建议'] },
  { id: 'official_letter', name: '函', group: '党政机关公文', sections: ['致函对象', '函告事项', '协商请求', '联系方式'], required: ['audience', 'matter'], optional: ['contact', 'deadline'] },
  { id: 'official_minutes', name: '纪要', group: '党政机关公文', sections: ['会议概况', '议定事项', '责任分工', '落实要求'] },
  { id: 'business_notice', name: '公司通知', group: '办公文档', sections: ['通知对象', '事项安排', '执行要求', '联系人'], required: ['audience', 'matter'] },
  { id: 'business_plan', name: '工作计划', group: '办公文档', sections: ['工作目标', '重点任务', '时间安排', '责任分工', '风险保障'] },
  { id: 'business_summary', name: '工作总结', group: '办公文档', sections: ['工作完成情况', '成果亮点', '问题不足', '经验复盘', '下一步'] },
  { id: 'business_proposal', name: '工作方案', group: '办公文档', sections: ['背景与目标', '实施步骤', '进度安排', '责任分工', '资源预算', '风险预案'] },
  { id: 'business_email', name: '商务邮件', group: '办公文档', sections: ['主题', '正文', '下一步动作', '礼貌结尾'] },
  { id: 'business_memo', name: '备忘录', group: '办公文档', sections: ['事项', '背景', '关键事实', '建议动作'] },
  { id: 'business_application', name: '申请', group: '办公文档', sections: ['申请事项', '申请理由', '资源费用', '预期结果', '审批请求'] },
  { id: 'business_meeting_minutes', name: '企业会议纪要', group: '办公文档', sections: ['会议主题', '讨论要点', '会议决策', '行动项', '责任人与截止时间'] },
  { id: 'business_daily_report', name: '日报', group: '办公文档', sections: ['今日完成', '问题风险', '明日计划', '需协助事项'] },
  { id: 'business_weekly_report', name: '周报', group: '办公文档', sections: ['本周进展', '成果数据', '问题风险', '下周计划', '需协助事项'] },
  { id: 'business_monthly_report', name: '月报', group: '办公文档', sections: ['月度目标', '完成情况', '核心数据', '问题复盘', '下月计划'] },
  { id: 'business_rectification_report', name: '整改报告', group: '办公文档', sections: ['问题概述', '原因分析', '整改措施', '完成情况', '长效机制'], required: ['matter', 'result'], optional: ['owner', 'deadline', 'risk'] },
  { id: 'business_situation_statement', name: '情况说明', group: '办公文档', sections: ['基本情况', '事实经过', '原因说明', '处理情况', '后续措施'] },
  { id: 'business_approval_note', name: '审批说明', group: '办公文档', sections: ['审批事项', '背景原因', '依据与费用', '风险说明', '审批建议'] },
  { id: 'business_talk_record', name: '谈话记录', group: '办公文档', sections: ['谈话信息', '谈话内容', '主要问题', '本人意见', '后续要求'], optional: ['time', 'location', 'audience', 'owner'] },
  { id: 'business_training_record', name: '培训记录', group: '办公文档', sections: ['培训主题', '时间地点', '参训人员', '培训内容', '考核与反馈'], optional: ['time', 'location', 'audience', 'result'] },
  { id: 'business_sop', name: 'SOP', group: '办公文档', sections: ['目的', '适用范围', '职责', '操作步骤', '异常处理', '检查记录'], required: ['matter'], optional: ['owner', 'risk'] },
  { id: 'student_leave_note', name: '请假条', group: '学生场景', sections: ['称谓', '请假原因', '请假时间', '承诺', '署名日期'] },
  { id: 'student_report', name: '实习/实践报告', group: '学生场景', sections: ['实践背景', '实践过程', '收获体会', '问题反思', '总结'] },
  { id: 'student_activity_plan', name: '活动策划', group: '学生场景', sections: ['活动主题', '目的', '时间地点', '活动流程', '人员分工', '预算物料', '风险预案'] },
  { id: 'student_speech', name: '演讲稿', group: '学生场景', sections: ['开场', '核心观点', '案例', '总结号召'] },
  { id: 'student_review', name: '学习总结', group: '学生场景', sections: ['学习内容', '主要收获', '问题不足', '改进计划'] },

  // —— 行业专用文书（0.6.3）——
  // 结构按各行业公开的常见文书要素拟定，用于把口述整理成"能直接用"的骨架，
  // 不替代本单位的正式表单与审批规范；发布前须由业务方审核。
  // 这类文书的共同硬要求：事实与判断分开、时间/人员/编号一律不许臆造。
  {
    id: 'industry_prison_reward_punishment', name: '罪犯奖惩审批（草稿）', group: '行业专用文书',
    industries: ['prison'],
    sections: ['罪犯基本情况', '事实经过', '认定依据', '拟处理意见', '监区意见', '待补充要素'],
    required: ['matter'], optional: ['time', 'location', 'owner', 'basis', 'result'],
    tone: '客观、准确、要素齐全，事实与处理意见分开表述',
    prohibited: [...COMMON_PROHIBITED, '不得臆造罪犯姓名、编号、刑期或考核分数', '不得替代监狱正式审批表与审批流程'],
  },
  {
    id: 'industry_prison_situation_analysis', name: '狱情分析（草稿）', group: '行业专用文书',
    industries: ['prison'],
    sections: ['总体情况', '重点罪犯动态', '突出问题', '风险研判', '下一步措施'],
    required: ['matter'], optional: ['time', 'owner', 'risk', 'deadline'],
    tone: '实事求是、重点突出，风险判断要有事实支撑',
    prohibited: [...COMMON_PROHIBITED, '不得编造数据或罪犯动态', '涉密内容不得写入本稿'],
  },
  {
    id: 'industry_police_incident_record', name: '接处警登记（草稿）', group: '行业专用文书',
    industries: ['public_security'],
    sections: ['接警信息', '警情内容', '出警与到场', '现场处置', '处理结果', '待补充要素'],
    required: ['matter'], optional: ['time', 'location', 'owner', 'contact', 'result'],
    tone: '按时间顺序如实记录，用词中性，不作定性结论',
    prohibited: [...COMMON_PROHIBITED, '不得臆造报警人、当事人信息或警情编号', '不得在记录中直接下达定性结论'],
  },
  {
    id: 'industry_police_case_brief', name: '案情通报（草稿）', group: '行业专用文书',
    industries: ['public_security', 'political_legal'],
    sections: ['基本案情', '处置经过', '当前进展', '工作要求'],
    required: ['matter'], optional: ['time', 'location', 'owner', 'result'],
    tone: '简洁、准确、口径统一',
    prohibited: [...COMMON_PROHIBITED, '不得泄露侦查秘密与个人隐私', '未查证事实不得写成结论'],
  },
  {
    id: 'industry_medical_handover', name: '交接班记录（草稿）', group: '行业专用文书',
    industries: ['medical'],
    sections: ['值班时间与人员', '在院/重点患者', '病情变化与处置', '未完成事项', '交班注意事项'],
    required: ['matter'], optional: ['time', 'owner', 'risk'],
    tone: '客观、具体、可执行，重点患者单列',
    prohibited: [...COMMON_PROHIBITED, '不得编造生命体征、检验值或用药信息', '不得替代病历书写规范'],
  },
  {
    id: 'industry_education_parent_notice', name: '家长通知（草稿）', group: '行业专用文书',
    industries: ['education'],
    sections: ['称谓', '通知事项', '时间地点', '家长需配合事项', '联系方式'],
    required: ['matter', 'audience'], optional: ['time', 'location', 'contact', 'deadline'],
    tone: '亲切、清楚、便于家长一次读懂',
    prohibited: [...COMMON_PROHIBITED, '不得公开点名批评学生', '不得写入学生成绩、病史等敏感信息'],
  },
  {
    id: 'industry_gov_supervision_notice', name: '督办通知（草稿）', group: '行业专用文书',
    industries: ['government', 'political_legal', 'general_office'],
    sections: ['督办事项', '责任单位', '工作要求', '完成时限', '反馈方式'],
    required: ['matter'], optional: ['owner', 'deadline', 'contact', 'basis'],
    tone: '指向明确、要求具体、时限清楚',
    prohibited: [...COMMON_PROHIBITED, '不得虚设责任单位或完成时限'],
  },
];

export const OFFICE_TEMPLATES: OfficeTemplateDefinition[] = TEMPLATE_SPECS.map(createTemplate);

interface IndustrySpec {
  id: IndustryPackId;
  name: string;
  description: string;
  terms: string[];
  templates?: RewriteScenario[];
  risks?: string[];
  styles?: string[];
}

const DEFAULT_PACK_TEMPLATES: RewriteScenario[] = [
  'general', 'meeting_notes', 'work_report', 'todo_list', 'business_situation_statement',
];

// 该行业专属的文书（模板自己声明适用行业，这里反查），置于推荐列表最前。
// 只是排序优先，不禁用其它模板——客户仍可自由组合。
function getIndustryOwnTemplates(industryId: IndustryPackId): RewriteScenario[] {
  return TEMPLATE_SPECS
    .filter((spec) => spec.industries?.includes(industryId))
    .map((spec) => spec.id);
}

function createIndustryPack(spec: IndustrySpec): IndustryPackDefinition {
  const recommended = spec.templates ?? DEFAULT_PACK_TEMPLATES;
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    template_ids: Array.from(new Set([...getIndustryOwnTemplates(spec.id), ...recommended])),
    lexicon: Array.from(new Set([...spec.terms, ...COMMON_OFFICE_TERMS])),
    style_rules: spec.styles ?? ['使用本行业规范表达', '事实与判断分开表述', '不确定信息标记待补充'],
    risk_terms: spec.risks ?? ['重大风险', '责任事故', '违规操作'],
  };
}

const INDUSTRY_SPECS: IndustrySpec[] = [
  { id: 'general_office', name: '通用办公', description: '日常行政、会议、汇报和协同办公。', terms: ['协同办公', '事项督办', '会议议题', '审批意见', '资料报送', '工作汇报', '请示', '批复', '通知', '通报', '会议纪要', '值班值守', '综合科', '办公室', '文秘', '收文', '发文', '拟稿', '会签', '督查督办', '工作专班', '牵头单位', '责任分工', '限期整改'] },
  { id: 'political_legal', name: '政法', description: '政法工作、平安建设和社会治理。', terms: ['政法委', '政法委员会', '平安建设', '社会治理', '矛盾纠纷排查', '综治中心', '维稳工作', '扫黑除恶', '信访维稳', '网格化管理', '网格员', '一村一警', '群防群治', '风险隐患排查', '重点人员管控', '联防联控', '执法监督', '政法队伍', '政治督察', '涉稳信息', '应急处突', '综治考核'], risks: ['涉密信息', '敏感案事件', '群体性事件'] },
  { id: 'public_security', name: '公安', description: '接处警、治安、刑侦和基层公安业务。', terms: ['接处警', '警情处置', '治安管理', '治安管理科', '刑事侦查', '刑侦大队', '案件侦办', '执法办案区', '嫌疑人', '询问笔录', '警务督查', '警务督查科', '督察', '督察大队', '法制科', '治安大队', '刑警队', '社区民警', '出警', '警情研判', '派出所', '户籍室', '巡特警', '巡逻防控', '交警大队', '禁毒大队', '网安大队', '情报中心', '执勤', '盘查', '布控', '传唤', '拘传', '行政拘留', '刑事拘留', '立案', '破案', '抓获', '移送起诉', '治安处罚', '调解', '走访', '一标三实', '警情通报', '值班备勤'], risks: ['侦查秘密', '警务信息', '人员隐私'] },
  { id: 'prison', name: '监狱', description: '监管安全、刑罚执行、教育改造和狱政业务。', terms: ['狱政管理', '狱政管理科', '狱政科', '狱侦', '狱侦管理', '狱侦科', '狱内侦查', '教育改造', '教育改造科', '生活卫生科', '刑罚执行科', '监管安全', '监管改造', '罪犯考核', '会见管理', '提请减刑假释', '刑罚执行', '风险排查', '警情处置', '指挥中心', '监区', '监区长', '分监区', '分监区长', '教导员', '管教民警', '值班民警', '清监查号', '点名', '个别教育', '集体教育', '顽危犯', '重点罪犯', '劳动改造', '计分考核', '奖惩审批', '暂予监外执行', '狱情研判', '亲情电话', '离监探亲', '入监教育', '出监教育', '安全防范', '安全检查', '违规违纪', '禁闭', '警戒', '巡视', '交接班'], risks: ['脱逃', '自伤自残', '违禁品', '监管事故', '狱内案件'] },
  { id: 'court', name: '法院', description: '立案、审判、执行和司法文书。', terms: ['立案审查', '立案庭', '合议庭', '审判庭', '庭审笔录', '裁判文书', '判决书', '裁定书', '调解书', '执行异议', '强制执行', '执行局', '送达回证', '审判流程', '开庭审理', '当庭宣判', '审判委员会', '审判长', '书记员', '陪审员', '上诉', '再审', '申诉', '保全', '结案', '归档', '案卷'], risks: ['未决案件', '审判秘密', '当事人隐私'] },
  { id: 'procuratorate', name: '检察', description: '刑事、民事、行政和公益诉讼检察。', terms: ['审查逮捕', '审查起诉', '法律监督', '公益诉讼', '检察建议', '不起诉决定', '案件管理', '侦查监督', '刑事检察', '民事检察', '行政检察', '未成年人检察', '检察官', '员额检察官', '出庭支持公诉', '讯问', '退回补充侦查', '批准逮捕', '立案监督', '认罪认罚', '案件受理'], risks: ['检察工作秘密', '案件线索', '证人信息'] },
  { id: 'judicial_administration', name: '司法行政', description: '社区矫正、普法、调解和法律服务。', terms: ['社区矫正', '社区矫正对象', '安置帮教', '人民调解', '行政复议', '行政应诉', '法律援助', '普法宣传', '司法所', '公证', '仲裁', '律师管理', '基层法律服务', '矫正小组', '入矫', '解矫', '思想汇报', '教育学习', '公益活动', '走访核查'] },
  { id: 'government', name: '政府机关', description: '机关公文、政务督查和公共服务。', terms: ['政务督查', '政策落实', '政务公开', '民生实事', '请示报告', '党组会议', '常务会议', '专题会议', '办公会', '议事协调', '牵头领办', '督办函', '政府工作报告', '重点工作', '营商环境', '放管服', '政务服务中心', '一网通办', '为民办实事', '调研', '视察', '汇报材料', '领导批示', '办文办会办事'] },
  { id: 'education', name: '教育', description: '学校教学、教研、德育和家校沟通。', terms: ['教学设计', '课程标准', '教研活动', '学情分析', '家校沟通', '德育工作', '班主任', '教务处', '德育处', '教研组', '备课组', '公开课', '听课评课', '教学质量', '学业评价', '素质教育', '双减', '课后服务', '主题班会', '家长会', '学生管理', '教学计划', '期中考试', '期末考试'] },
  { id: 'medical', name: '医疗', description: '诊疗、护理、病案和医院管理。', terms: ['主诉', '现病史', '既往史', '诊疗方案', '护理记录', '医嘱', '病案首页', '不良事件', '门诊', '住院', '查房', '会诊', '病历', '入院记录', '出院小结', '手术记录', '临床路径', '院感', '合理用药', '分级诊疗', '医患沟通', '交接班'], risks: ['患者隐私', '用药安全', '医疗事故'] },
  { id: 'finance', name: '金融', description: '投融资、风控和金融运营。', terms: ['资产配置', '风险敞口', '现金流', '收益率', '尽职调查', '估值模型', '合规审查', '投前评审', '投后管理', '资金募集', '风险准备金', '流动性', '资产负债', '内控合规', '资管', '净值', '底层资产', '风险偏好', '压力测试'] },
  { id: 'banking', name: '银行', description: '信贷、柜面、贷后和反洗钱。', terms: ['授信额度', '贷款审批', '贷后管理', '不良贷款', '反洗钱', '客户尽调', '核心系统', '对公业务', '对私业务', '柜面', '信贷审批', '抵押担保', '贷款五级分类', '风险预警', '尽职免责', '大额可疑', '客户经理', '网点', '开户', '流水', '还款计划'] },
  { id: 'insurance', name: '保险', description: '承保、核保、理赔和保全。', terms: ['保险责任', '核保', '理赔调查', '保单保全', '免赔额', '赔付率', '续期管理', '承保', '出险', '定损', '拒赔', '免责条款', '保额', '保费', '受益人', '现金价值', '退保', '再保险', '保险精算'] },
  { id: 'real_estate', name: '房产', description: '房地产开发、营销和交付。', terms: ['土地出让', '容积率', '预售许可', '认购协议', '网签备案', '交付标准', '去化率', '拿地', '开盘', '样板间', '意向客户', '按揭', '首付', '产权证', '不动产登记', '物业交付', '业态', '得房率', '在建工程', '施工许可'] },
  { id: 'property_management', name: '物业', description: '园区物业、报修、巡检和业主服务。', terms: ['物业费', '报事报修', '设施巡检', '业主大会', '业主委员会', '秩序维护', '保洁绿化', '工单', '客服中心', '监控中心', '门岗', '安防', '消防巡查', '设备房', '公区维护', '收缴率', '投诉处理', '入住办理', '装修管理', '停车管理'] },
  { id: 'ecommerce', name: '电商', description: '商品、店铺、订单和平台运营。', terms: ['商品详情页', '转化率', '客单价', '退款率', '活动报名', '库存周转', '平台规则', 'SKU', '上架', '爆款', '流量', '曝光', '点击率', '收藏加购', '售后', '发货时效', '好评率', '店铺评分', '直通车', '618', '双十一', 'GMV'] },
  { id: 'customer_service', name: '客服', description: '咨询、投诉、工单和回访。', terms: ['首次响应', '工单升级', '客户投诉', '满意度', '回访记录', '服务话术', '处理时效', '在线客服', '来电咨询', '疑难工单', '知识库', '一次解决率', '安抚', '升级处理', '客诉', '服务规范', '接通率', '通话记录'] },
  { id: 'sales', name: '销售', description: '客户开发、商机和成交复盘。', terms: ['销售线索', '商机阶段', '客户画像', '报价方案', '成交周期', '回款计划', '复购率', '客户跟进', '需求挖掘', '异议处理', '促单', '签约', '业绩指标', '销售漏斗', '大客户', '拜访记录', '转介绍', '回访', '成单率'] },
  { id: 'manufacturing', name: '制造', description: '生产、工艺、设备和质量管理。', terms: ['生产计划', '工艺流程', '设备点检', '质量异常', '良品率', '物料清单', '停线', '车间', '产线', '排产', '在制品', '首件检验', '巡检', '来料检验', '出货检验', '设备保养', '安全生产', '现场管理', '标准作业', '产能', '交期'] },
  { id: 'logistics', name: '物流', description: '仓储、运输和配送运营。', terms: ['入库单', '出库单', '干线运输', '末端配送', '签收率', '仓位', '运输时效', '分拣', '装车', '运单', '发运', '中转', '库存盘点', '拣货', '打包', '车辆调度', '路由', '妥投', '异常件', '在途', '仓配一体'] },
  { id: 'catering', name: '餐饮', description: '门店、后厨、食安和经营管理。', terms: ['翻台率', '客单价', '后厨管理', '食品留样', '毛利率', '排班', '供应链', '前厅', '出餐', '备餐', '食材验收', '明厨亮灶', '卫生检查', '菜品', '损耗', '营业额', '外卖', '堂食', '门店巡检', '收银'] },
  { id: 'live_streaming', name: '直播', description: '直播策划、投流、转化和复盘。', terms: ['直播间', '场观', '停留时长', '转粉率', '投流', '主播话术', '开播', '憋单', '福袋', '连麦', '选品', '排品', '在线人数', '互动率', '下单转化', '复盘', '直播脚本', '中控', 'GMV'] },
  { id: 'local_services', name: '本地生活', description: '到店、团购和本地商家运营。', terms: ['到店核销', '团购套餐', '门店曝光', '评价分', '达人探店', '本地推', '履约率', '套餐设置', '核销率', '门店评分', '差评回复', '会员', '储值', '引流', '闭店率', '商家后台', '订单核销', '到店消费'] },
  { id: 'law_firm', name: '律所', description: '法律咨询、案件代理和律师工作记录。', terms: ['委托代理', '法律意见书', '证据目录', '庭审准备', '争议焦点', '律师函', '案件归档', '代理词', '答辩状', '起诉状', '质证', '举证', '尽职调查', '合同审查', '非诉', '法律顾问', '出庭', '立案登记', '风险代理', '利益冲突'] },
  { id: 'tax_accounting', name: '财税', description: '会计核算、税务申报和审计。', terms: ['会计凭证', '纳税申报', '进项税额', '销项税额', '成本结转', '财务报表', '税务稽查', '审计底稿', '增值税', '企业所得税', '个人所得税', '发票', '记账', '对账', '月末结账', '固定资产折旧', '汇算清缴', '税务筹划', '往来款', '现金流量表', '资产负债表'] },
  { id: 'human_resources', name: '人事', description: '招聘、绩效、薪酬和员工关系。', terms: ['岗位说明书', '人才盘点', '绩效考核', '薪酬结构', '劳动合同', '离职交接', '员工关系', '招聘', '面试', '入职', '转正', '调岗', '社保公积金', '考勤', '培训', '晋升', '绩效面谈', '编制', '花名册', '人事档案', '试用期'] },
  { id: 'administration', name: '行政', description: '行政事务、资产、会务和后勤。', terms: ['固定资产', '办公用品', '会议保障', '车辆管理', '印章管理', '档案管理', '后勤保障', '接待', '值班', '安保', '食堂', '物资采购', '资产盘点', '公文流转', '用印审批', '会务安排', '差旅', '报销', '门禁', '保洁'] },
  { id: 'project_management', name: '项目管理', description: '范围、进度、成本和风险管理。', terms: ['项目章程', '里程碑', '关键路径', '变更申请', '风险登记册', '验收标准', '项目复盘', '需求范围', '进度计划', '甘特图', '资源分配', '干系人', '交付物', '项目立项', '结项', '风险应对', '问题跟踪', '周报', '例会', '范围蔓延'] },
  { id: 'software_development', name: '软件开发', description: '需求、研发、测试和发布。', terms: ['API', 'commit', 'merge', 'deploy', 'release', '代码评审', '单元测试', '回归测试', '技术债', '需求评审', '接口文档', '联调', '灰度发布', '回滚', '生产环境', '测试环境', 'bug', '缺陷', '版本迭代', '排期', '架构设计', '重构'] },
  { id: 'product_management', name: '产品', description: '用户研究、需求和产品迭代。', terms: ['PRD', 'MVP', 'roadmap', 'backlog', '用户故事', '需求评审', '版本规划', '用户调研', '竞品分析', '需求池', '优先级', '原型', '埋点', '数据分析', '留存', '转化漏斗', '灰度', 'AB测试', '迭代计划', '用户画像'] },
  { id: 'design', name: '设计', description: '视觉、交互和设计交付。', terms: ['Figma', '设计规范', '交互稿', '视觉稿', '组件库', '用户体验', '设计走查', '线框图', '原型', '设计评审', '视觉还原', '切图', '标注', '设计系统', '配色', '字体规范', '响应式', '可用性', '设计交付', '设计稿'] },
  { id: 'procurement', name: '采购', description: '询价、比价、合同和供应商管理。', terms: ['采购申请', '询价单', '比价表', '供应商准入', '采购合同', '到货验收', '采购周期', '采购计划', '招采', '框架协议', '供应商评估', '付款申请', '入库', '对账', '成本控制', '寻源', '订单跟催', '质保', '退换货', '采购目录'] },
  { id: 'bidding', name: '招投标', description: '招标、投标、评审和合同授予。', terms: ['招标文件', '投标文件', '资格预审', '评标办法', '中标通知书', '保证金', '澄清答疑', '开标', '评标', '定标', '标书', '招标公告', '投标报价', '技术标', '商务标', '废标', '流标', '合同签订', '履约保证金', '中标候选人', '专家评审'], risks: ['围标串标', '废标', '资格造假'] },
];

export const INDUSTRY_PACKS: IndustryPackDefinition[] = INDUSTRY_SPECS.map(createIndustryPack);

const TEMPLATE_BY_ID = new Map(OFFICE_TEMPLATES.map((template) => [template.id, template]));
const INDUSTRY_BY_ID = new Map(INDUSTRY_PACKS.map((pack) => [pack.id, pack]));

const SLOT_LABELS: Record<OfficeTemplateSlot, string> = {
  time: '时间', location: '地点', audience: '对象', matter: '具体事项', owner: '责任人',
  deadline: '完成时限', contact: '联系方式', basis: '依据', result: '处理结果', risk: '风险点',
};

const SLOT_PATTERNS: Record<OfficeTemplateSlot, RegExp> = {
  time: /(\d{1,4}[年/-]\d{1,2}|\d{1,2}[月日号点时分]|今天|明天|后天|周[一二三四五六日天]|星期[一二三四五六日天])/u,
  location: /(地点|会议室|办公室|现场|线上|腾讯会议|园区|大厅|教室|监区)/u,
  audience: /(各部门|全体|有关单位|同志|同事|客户|业主|员工|学生|家长|参会人员|收件人)/u,
  matter: /[\p{Script=Han}A-Za-z0-9]{4,}/u,
  owner: /(责任人|负责人|牵头|承办|经办|由.+负责)/u,
  deadline: /(截止|完成时限|于.+前|不得晚于|本周内|本月底|按期完成)/u,
  contact: /(联系|电话|手机|邮箱|@|\d{7,})/u,
  basis: /(根据|依据|按照|依照|经研究|会议决定)/u,
  result: /(完成|已办结|处理结果|同意|不同意|通过|整改完毕)/u,
  risk: /(风险|隐患|问题|异常|不足|事故|延误)/u,
};

export function getOfficeTemplateCatalog(): OfficeTemplateCatalog {
  return { templates: OFFICE_TEMPLATES, industry_packs: INDUSTRY_PACKS };
}

export function getOfficeTemplate(id: RewriteScenario | undefined): OfficeTemplateDefinition {
  return TEMPLATE_BY_ID.get(id ?? 'general') ?? TEMPLATE_BY_ID.get('general')!;
}

export function getIndustryPack(id: IndustryPackId | undefined): IndustryPackDefinition {
  return INDUSTRY_BY_ID.get(id ?? 'general_office') ?? INDUSTRY_BY_ID.get('general_office')!;
}

export function checkTemplateSlots(text: string, templateId: RewriteScenario): TemplateSlotCheck {
  const template = getOfficeTemplate(templateId);
  const missingSlots = template.required_slots.filter((slot) => !SLOT_PATTERNS[slot].test(text));
  return {
    missing_slots: missingSlots,
    missing_labels: missingSlots.map((slot) => SLOT_LABELS[slot]),
    complete: missingSlots.length === 0,
  };
}

// 行业术语匹配：只挑「当前文本里真正出现的」行业词。
//
// 为什么不直接把整包词塞进去：
//   1) 旧实现是 lexicon.slice(0, 30)——取数组前 30 个，与文本毫无关系，等于随机；
//   2) 接入大词库后单个领域可达上万词（医学 18465），全量注入既撑爆 prompt 也拖慢本地改写。
// 只保护命中的词，既准确又可控。长词优先（"狱政管理科" 比 "狱政" 更具体）。
export function matchIndustryTerms(
  text: string,
  industryId: IndustryPackId,
  limit = 60,
  extraTerms: string[] = []
): string[] {
  const source = (text || '').trim();
  if (!source) {
    return [];
  }
  const pack = getIndustryPack(industryId);
  const candidates = new Set<string>([...pack.lexicon, ...extraTerms]);
  const matched: string[] = [];
  for (const term of candidates) {
    const t = (term || '').trim();
    if (t.length >= 2 && source.includes(t)) {
      matched.push(t);
    }
  }
  return matched
    .sort((a, b) => b.length - a.length || a.localeCompare(b, 'zh-CN'))
    .slice(0, Math.max(0, limit));
}

// 行业包 → 系统大词库类目的映射。
//
// 必须如实说明的数据现实：85MB 系统词库共 23 个类目，其中 72% 是「通用基础词库」（50 万条通用汉语词），
// 真正成规模的领域类目只有 5 个——医学/健康 18465、IT/AI/互联网 15270、法律 9801、餐饮/饮食 8949、财经 3825。
// 「办公/会议」只有 12 条、「电商/直播/短视频」12 条、「教育/培训」5 条，接了也等于没接。
// 因此监狱、公安、物业等 21 个包从大词库拿不到任何东西，只能靠用户自建词表补——这一点在设置页要讲清楚，
// 不能让客户以为选了包就自动有几万个词。
const INDUSTRY_LEXICON_CATEGORIES: Partial<Record<IndustryPackId, string[]>> = {
  medical: ['医学/健康'],
  software_development: ['IT/AI/互联网', 'IT/AI'],
  product_management: ['IT/AI/互联网', 'IT/AI'],
  court: ['法律', '财经/法律'],
  procuratorate: ['法律', '财经/法律'],
  law_firm: ['法律', '财经/法律'],
  political_legal: ['法律', '财经/法律'],
  judicial_administration: ['法律', '财经/法律'],
  catering: ['餐饮/饮食'],
  finance: ['财经', '财经/法律'],
  banking: ['财经', '财经/法律'],
  insurance: ['财经', '财经/法律'],
  tax_accounting: ['财经', '财经/法律'],
};

/** 该行业包能从系统大词库借到词的类目；没有映射的包返回空数组（靠内置词 + 用户自建词表）。 */
export function getIndustryLexiconCategories(industryId: IndustryPackId | undefined): string[] {
  return INDUSTRY_LEXICON_CATEGORIES[industryId ?? 'general_office'] ?? [];
}

// 按字符预算挑选要写进 prompt 的行业词，替代写死的「前 30 个」。
function selectTermsWithinBudget(terms: string[], maxChars = 600): string[] {
  const selected: string[] = [];
  let used = 0;
  for (const term of terms) {
    const cost = term.length + 1; // 含分隔顿号
    if (used + cost > maxChars) {
      break;
    }
    selected.push(term);
    used += cost;
  }
  return selected;
}

export function buildOfficeTemplatePrompt(templateId: RewriteScenario, industryId: IndustryPackId): string {
  const template = getOfficeTemplate(templateId);
  const industry = getIndustryPack(industryId);
  return [
    `文档类型：${template.name}`,
    `适用行业：${industry.name}`,
    `输出结构：${template.output_sections.join('、')}`,
    `表达要求：${template.tone}；${industry.style_rules.join('；')}`,
    // 旧实现固定取前 30 个（与文本无关）；改为按字符预算，能带上明显更多领域词。
    // 与当前文本真正相关的术语另由 preserveTerms 注入（见 matchIndustryTerms）。
    `专业词优先保护：${selectTermsWithinBudget(industry.lexicon).join('、')}`,
    `禁止事项：${template.prohibited.join('；')}`,
    '原文缺少必填信息时写“待补充”，禁止自行编造。',
  ].join('\n');
}

// 找出稿件里仍是占位的要素（模板会把缺失信息写成"待补充"），供面板提示用户还差什么。
// 返回的是要素名（如 主送机关 / 联系人），不是整行原文。
const PLACEHOLDER_LINE_RE = /待补充|待根据[^\n]*补充/u;

export function findPendingPlaceholders(text: string, limit = 12): string[] {
  const lines = (text || '').split('\n').map((line) => line.trim());
  const found: string[] = [];
  let lastHeading = '';

  for (const line of lines) {
    if (!line) {
      continue;
    }
    // 小标题优先判定：像"三、待补充要素"这种标题本身带占位词，它不是缺失项，
    // 真正缺的要素在它下面那行，所以只更新 lastHeading 后跳过。
    const headingMatch = line.match(/^(?:[一二三四五六七八九十]+、|（[一二三四五六七八九十]+）|\d+[.、])\s*(.*)$/u);
    if (headingMatch) {
      lastHeading = headingMatch[1].trim().replace(/待补充要素?/u, '').trim() || lastHeading;
      continue;
    }
    if (!PLACEHOLDER_LINE_RE.test(line)) {
      continue;
    }

    // 形如「主送机关：待补充」——冒号前就是要素名。
    const labeled = line.match(/^(.+?)[：:]\s*待补充/u);
    if (labeled) {
      found.push(labeled[1].trim());
      continue;
    }

    // 形如「发文机关、发文字号、成文日期、联系人及附件信息待补充。」——拆成多个要素。
    const listed = line.replace(/(?:等)?(?:信息)?待补充[。.]?$/u, '').trim();
    if (listed && listed !== line) {
      const parts = listed.split(/[、，,]|及|和/u).map((part) => part.trim()).filter(Boolean);
      if (parts.length > 0) {
        found.push(...parts);
        continue;
      }
    }

    // 形如「待补充。」「待根据会议内容补充。」独占一行——归到最近的小标题名下。
    found.push(lastHeading || '未填写内容');
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const item of found) {
    const normalized = item.replace(/\s+/g, '').replace(/[。.]$/u, '');
    if (!normalized || normalized.length > 20 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique.slice(0, limit);
}

export function buildOfficeActionCards(rawText: string, correctedText: string, formalText: string): OfficeActionCard[] {
  const source = correctedText.trim() || rawText.trim();
  const todoLines = source.split(/[。；\n]/u).filter((line) => /(需要|请|应当|负责|截止|完成|跟进)/u.test(line));
  const riskLines = source.split(/[。；\n]/u).filter((line) => /(风险|问题|隐患|异常|不足|延误)/u.test(line));
  return [
    { id: 'raw', label: '原文', text: rawText, available: Boolean(rawText.trim()) },
    { id: 'corrected', label: '修正稿', text: correctedText, available: Boolean(correctedText.trim()) },
    { id: 'formal', label: '结构化参考', text: formalText, available: Boolean(formalText.trim()) },
    { id: 'todo', label: '待办', text: todoLines.join('\n'), available: todoLines.length > 0 },
    { id: 'risk', label: '风险点', text: riskLines.join('\n'), available: riskLines.length > 0 },
    { id: 'reply', label: '下一步回复', text: source ? `已收到。将根据上述事项继续推进，并及时反馈进展。` : '', available: Boolean(source) },
  ];
}

