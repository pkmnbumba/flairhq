var request = require("request-promise"),
    _ = require('lodash');

let globallyRateLimited = false;
let rateLimitedRoutes = {};

const makeRequest = async function (requestType, url, body, headers) {
  removeNonRateLimited();
  if (globallyRateLimited || isRateLimited(url)) {
    throw {statusCode: 504, error: "Rate limited"};  
  }
  const options = {
    method: requestType,
    url: url,
    body: body,
    json: true, 
    headers: headers,
    resolveWithFullResponse: true
  };
  try {
    const response = await request(options);
    updateRateLimits(response.headers, url);
    return response.body;
  } catch (error) {
    sails.log.error(
      'Discord error: ' + requestType + 
      ' request sent to ' + url + 
      ' returned ' + error.statusCode);
    sails.log.error('Form data sent: ' + JSON.stringify(body));
    throw {statusCode: error.statusCode, error: '(Discord response)'};
  }
};

const updateRateLimits = function (resHeaders) {
  if (resHeaders['x-ratelimit-remaining'] === 0) {
    rateLimitedRoutes.url = Number(resHeaders['x-ratelimit-reset']) + 1;  
  } else if (resHeaders['x-ratelimit-global']) {
    globallyRateLimited = true;
    rateLimitedRoutes['global'] = Number(Date.now()) + 
      Number(resHeaders['retry-after'])/1000 + 1;
  }
};

const isRateLimited = function (url) {
  return _.includes(rateLimitedRoutes, url);
};

const removeNonRateLimited = function () {
  for (let route in rateLimitedRoutes) {
    if (isResetTimePassed(rateLimitedRoutes[route])) {
      delete rateLimitedRoutes[route];
      if(route === 'global') {
        globallyRateLimited = false;
      }
    }
  }
};

const isResetTimePassed = function (time) {
  const timeDifference = Number(Date.now() - new Date(time).getTime());
  return timeDifference < 0;
};

exports.getAccessToken = async function (code) {
  const redirect_uri = encodeURIComponent(sails.config.discord.redirect_host + '/discord/callback');
  const url = 'https://discordapp.com/api/oauth2/token';
  const body =
    'client_id=' + sails.config.discord.client_id + 
    '&client_secret=' + sails.config.discord.client_secret + '&grant_type=authorization_code&code=' + code + 
    '&redirect_uri=' + redirect_uri +
    '&scope=identify%20guilds.join'
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  try {
    const token = await request.post({
      url: url,
      body: body,
      json: true,
      headers: headers
    });
    return token;
  } catch (err) {
    throw {error: 'Error retrieving token from Discord; Discord responded with status code ' + err.statusCode};
  }
};

exports.getCurrentUser = async function (token) {
  const url = 'https://discordapp.com/api/users/@me';
  const auth = 'Bearer ' + token;
  const headers = {
    "Authorization": auth,
    "Content-Type": "application/x-www-form-urlencoded" 
  };
  try {
    const currentUser = await makeRequest('GET', url, undefined, headers);
    return currentUser.id;
  } catch (err) {
    throw {error: 'Error retrieving current user from Discord; Discord responded with status code ' + err.statusCode};
  }
};

exports.addUserToGuild = async function (token, user, nick) {
  const url = 'https://discordapp.com/api/guilds/' + sails.config.discord.server_id + '/members/' + user;
  const auth = 'Bot ' + sails.config.discord.client_token;
  const body = { 
    'access_token': token,
    'nick': nick,
    'roles' : sails.config.discord.authenticatedRole_id
  };
  const headers = {
    "Authorization": auth,
    "Content-Type": "application/json"
  };
  const path = '';
  try {
    const response = await makeRequest('PUT', url, body, headers); 
    return response;
  } catch (err) {
    throw {error: 'Error adding user to guild; Discord responded with status code ' + err.statusCode};
  }
};