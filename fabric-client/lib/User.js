/*
 Copyright 2016 IBM All Rights Reserved.

 Licensed under the Apache License, Version 2.0 (the 'License');
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

	  http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an 'AS IS' BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/

'use strict';

var util = require('util');
var sdkUtils = require('./utils.js');
var api = require('./api.js');
var logger = sdkUtils.getLogger('User.js');
var idModule = require('./msp/identity.js');
var Identity = idModule.Identity;
var SigningIdentity = idModule.SigningIdentity;
var Signer = idModule.Signer;

/**
 * The User class represents users that have been enrolled and represented by
 * an enrollment certificate (ECert) and a signing key. The ECert must have
 * been signed by one of the CAs the blockchain network has been configured to trust.
 * An enrolled user (having a signing key and ECert) can conduct chaincode instantiate,
 * transactions and queries with the Channel.
 *
 * User ECerts can be obtained from a CA beforehand as part of installing and instantiating
 * the application, or it can be obtained from the optional Fabric CA service via its
 * enrollment process.
 *
 * Sometimes User identities are confused with Peer identities. User identities represent
 * signing capability because it has access to the private key, while Peer identities in
 * the context of the application/SDK only has the certificate for verifying signatures.
 * An application cannot use the Peer identity to sign things because the application doesn’t
 * have access to the Peer identity’s private key.
 *
 * @class
 */
var User = class {

	/**
	 * Constructor for a member.
	 *
	 * @param {string} cfg - The member name or an object with the following attributes:
	 *   - enrollmentID {string}: user name
	 *   - name {string}: user name, if "enrollmentID" is also specified, the "name" is ignored
	 *   - roles {string[]}: optional. array of roles
	 *   - affiliation {string}: optional. affiliation with a group or organization
	 */
	constructor(cfg) {
		if (util.isString(cfg)) {
			this._name = cfg;
			this._roles = null; //string[]
			this._affiliation = '';
		} else if (util.isObject(cfg)) {
			var req = cfg;
			this._name = req.enrollmentID || req.name;
			this._roles = req.roles || ['fabric.user'];
			this._affiliation = req.affiliation;
		}

		this._enrollmentSecret = '';
		this._identity = null;
		this._signingIdentity = null;
		this._mspId = '';
		this._cryptoSuite = null;
	}

	/**
	 * Get the member name.
	 * @returns {string} The member name.
	 */
	getName() {
		return this._name;
	}

	/**
	 * Get the roles.
	 * @returns {string[]} The roles.
	 */
	getRoles() {
		return this._roles;
	}

	/**
	 * Set the roles.
	 * @param roles {string[]} The roles.
	 */
	setRoles(roles) {
		this._roles = roles;
	}

	/**
	 * Get the affiliation.
	 * @returns {string} The affiliation.
	 */
	getAffiliation() {
		return this._affiliation;
	}

	/**
	 * Set the affiliation.
	 * @param {string} affiliation The affiliation.
	 */
	setAffiliation(affiliation) {
		this._affiliation = affiliation;
	}

	/**
	 * Get the {@link Identity} object for this User instance, used to verify signatures
	 * @returns {Identity} the identity object that encapsulates the user's enrollment certificate
	 */
	getIdentity() {
		return this._identity;
	}

	/**
	 * Get the {@link SigningIdentity} object for this User instance, used to generate signatures
	 * @returns {SigningIdentity} the identity object that encapsulates the user's private key for signing
	 */
	getSigningIdentity() {
		return this._signingIdentity;
	}

	getCryptoSuite() {
		return this._cryptoSuite;
	}

	/**
	 * Set the cryptoSuite.
	 *
	 * When the application needs to use crypto settings or a key store other than the default,
	 * it needs to set a cryptoSuite instance that was created with the desired CryptoSuite
	 * settings and CryptoKeyStore options.
	 *
	 * @param {CryptoSuite} cryptoSuite The cryptoSuite.
	 */
	setCryptoSuite(cryptoSuite) {
		this._cryptoSuite = cryptoSuite;
	}

	/**
	 * Set the enrollment object for this User instance
	 * @param {Key} privateKey the private key object
	 * @param {string} certificate the PEM-encoded string of certificate
	 * @param {string} mspId The Member Service Provider id for the local signing identity
	 * @returns {Promise} Promise for successful completion of creating the user's signing Identity
	 */
	setEnrollment(privateKey, certificate, mspId) {
		if (typeof privateKey === 'undefined' || privateKey === null || privateKey === '') {
			throw new Error('Invalid parameter. Must have a valid private key.');
		}

		if (typeof certificate === 'undefined' || certificate === null || certificate === '') {
			throw new Error('Invalid parameter. Must have a valid certificate.');
		}

		if (typeof mspId === 'undefined' || mspId === null || mspId === '') {
			throw new Error('Invalid parameter. Must have a valid mspId.');
		}

		this._mspId = mspId;

		if (!this._cryptoSuite) {
			this._cryptoSuite = sdkUtils.newCryptoSuite();
			this._cryptoSuite.setCryptoKeyStore(sdkUtils.newCryptoKeyStore());
		}

		return this._cryptoSuite.importKey(certificate)
		.then((pubKey) => {
			var identity = new Identity(certificate, pubKey, mspId, this._cryptoSuite);
			this._identity = identity;
			this._signingIdentity = new SigningIdentity(certificate, pubKey, mspId, this._cryptoSuite, new Signer(this._cryptoSuite, privateKey));
		});
	}

	/**
	 * Determine if this name has been enrolled.
	 * @returns {boolean} True if enrolled; otherwise, false.
	 */
	isEnrolled() {
		return this._identity !== null && this._signingIdentity != null;
	}

	/**
	 * Set the current state of this member from a string based JSON object
	 * @return {Member} Promise of the unmarshalled Member object represented by the serialized string
	 */
	fromString(str) {
		logger.debug('fromString --start');
		var state = JSON.parse(str);

		if (state.name !== this.getName()) {
			throw new Error('name mismatch: \'' + state.name + '\' does not equal \'' + this.getName() + '\'');
		}

		this._name = state.name;
		this._roles = state.roles;
		this._affiliation = state.affiliation;
		this._enrollmentSecret = state.enrollmentSecret;

		if (typeof state.mspid === 'undefined' || state.mspid === null || state.mspid === '') {
			throw new Error('Failed to find "mspid" in the deserialized state object for the user. Likely due to an outdated state store.');
		}
		this._mspId = state.mspid;

		if (!this._cryptoSuite) {
			this._cryptoSuite = sdkUtils.newCryptoSuite();
			this._cryptoSuite.setCryptoKeyStore(sdkUtils.newCryptoKeyStore());
		}

		var self = this;
		var pubKey;

		return this._cryptoSuite.importKey(state.enrollment.identity.certificate, { algorithm: api.CryptoAlgorithms.X509Certificate })
		.then((key) => {
			pubKey = key;

			var identity = new Identity( state.enrollment.identity.certificate, pubKey, self._mspId, this._cryptoSuite);
			self._identity = identity;

			// during serialization (see toString() below) only the key's SKI are saved
			// swap out that for the real key from the crypto provider
			return self._cryptoSuite.getKey(state.enrollment.signingIdentity);
		}).then((privateKey) => {
			// the key retrieved from the key store using the SKI could be a public key
			// or a private key, check to make sure it's a private key
			if (privateKey.isPrivate()) {
				self._signingIdentity = new SigningIdentity(
					state.enrollment.identity.certificate,
					pubKey,
					self._mspId,
					self._cryptoSuite,
					new Signer(self._cryptoSuite, privateKey));

				return self;
			} else {
				throw new Error(util.format('Private key missing from key store. Can not establish the signing identity for user %s', state.name));
			}
		});
	}

	/**
	 * Save the current state of this member as a string
	 * @return {string} The state of this member as a string
	 */
	toString() {
		var serializedEnrollment = {};
		if (this._signingIdentity) {
			serializedEnrollment.signingIdentity = this._signingIdentity._signer._key.getSKI();
		}

		if (this._identity) {
			serializedEnrollment.identity = {
				certificate: this._identity._certificate
			};
		}

		var state = {
			name: this._name,
			mspid: this._mspId,
			roles: this._roles,
			affiliation: this._affiliation,
			enrollmentSecret: this._enrollmentSecret,
			enrollment: serializedEnrollment
		};

		return JSON.stringify(state);
	}
};

module.exports = User;
