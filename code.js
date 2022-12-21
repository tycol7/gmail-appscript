const extractEmail = (str) => {
  const emailRegex = /<(\S+@\S+\.\S+)>/; // matches email addresses enclosed in angle brackets
  const email = str?.match(emailRegex);
  return email ? email[1] : null; // return the captured group, not the full match
};

const triageMessage = (messageId, mappedLabels) => {
  const messageHeader = Gmail.Users.Messages.get('me', messageId, {
    format: 'metadata',
  });

  // * Apply labels — Important: Create the labels in Gmail first *
  let labelIds = [mappedLabels['🤖']]; // always apply the '🤖' label to avoid reprocessing messages

  // ** Leadership **
  const leadership = new Set([
    'my_amazing_manager@company.com',
    'ceo@company.com',
    'head_of_hr@company.com',
  ]);
  const fromValue = messageHeader.payload.headers
    .filter((header) => header.name === 'From')
    .pop().value;
  const fromEmail = extractEmail(fromValue);
  const fromManagerExcludingAsana =
    fromValue.includes('Manager Name') && fromEmail !== 'no-reply@asana.com';
  if (leadership.has(fromEmail) || fromManagerExcludingAsana)
    labelIds.push(mappedLabels['Leadership']);

  // ** Mentions **

  // *** GitHub mentions ***
  const ccValue = messageHeader.payload.headers
    .filter((header) => header.name === 'Cc')
    .pop().value;
  const ccValues = ccValue.split(',');
  const mentionAtCced = ccValues.some(
    (value) => extractEmail(value) === 'mention@noreply.github.com'
  );

  // *** Asana / Google Docs mentions ***
  let mentionedInBody = false;
  const asanaOrGoogle = new Set([
    'no-reply@asana.com',
    'comments-noreply@docs.google.com',
  ]);
  if (asanaOrGoogle.has(fromEmail)) {
    try {
      const messageBody = Gmail.Users.Messages.get('me', messageId, {
        format: 'raw',
      });
      const messageBodyDecoded = messageBody.raw
        .map((x) => String.fromCharCode(x))
        .join('');
      mentionedInBody =
        messageBodyDecoded.includes('mentioned you') ||
        messageBodyDecoded.includes('@me@company.com');
    } catch (error) {
      Logger.log(`Messages.get() API failed with error ${error.toString()}`);
    }
  }

  if (mentionAtCced || mentionedInBody)
    labelIds.push(mappedLabels['Mentions']);

  // ** PRs **
  let archiveEmail = false;
  const subject = messageHeader.payload.headers
    .filter((header) => header.name === 'Subject')
    .pop().value;

  if (fromEmail === 'notifications@github.com') {
    if (subject.includes('PR')) labelIds.push(mappedLabels['PR']);

    const teammates = [
      'Hank Hill',
      'Rusty Shackleford',
      'Dale Gribble',
      'Bobby Hill',
    ];
    const fromTeammate = teammates.some((teammate) =>
      fromValue.includes(teammate)
    );
    if (!(fromTeammate || addressedToMentionAt)) {
      Logger.log(
        `Marking PR ${subject} for archive, since it is not from a teammate nor does it mention you`
      );
      archiveEmail = true;
    }
  }

  // * Asana *
  if (fromEmail === 'no-reply@asana.com' && !mentionedInBody) {
    Logger.log(
      `Marking ${subject} for archive, since it is from Asana and does not mention you.`
    );
    archiveEmail = true;
  }

  // * Perform actions *
  const labelActions = {};
  if (labelIds.length > 0) {
    labelActions.addLabelIds = labelIds;
  }
  if (archiveEmail) {
    labelActions.removeLabelIds = ['INBOX'];
  }

  if (Object.keys(labelActions).length > 0) {
    try {
      const applyLabels = Gmail.Users.Messages.modify(
        labelActions,
        'me',
        messageId
      );
    } catch (error) {
      Logger.log(`Messages.modify() API failed with error ${error.toString()}`);
    }
  }
};

const main = () => {
  try {
    const labels = Gmail.Users.Labels.list('me').labels;
    const mappedLabels = labels.reduce((map, label) => {
      map[label.name] = label.id;
      return map;
    }, {});

    try {
      const messages = Gmail.Users.Messages.list('me', {
        maxResults: 500,
        q: '-label:🤖',
        labelIds: ['INBOX'],
      }).messages; // only return messages in the inbox without the '🤖' label
      messages?.map((message) => triageMessage(message.id, mappedLabels));
    } catch (error) {
      Logger.log(`Messages.list() API failed with error ${error.toString()}`);
    }
  } catch (error) {
    Logger.log(`Labels.list() API failed with error ${error.toString()}`);
  }
};
