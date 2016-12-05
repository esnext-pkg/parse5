import OpenElementStack from '../parser/open_element_stack';
import Tokenizer from '../tokenizer';
import HTML from '../common/html';


//Aliases
const $ = HTML.TAG_NAMES;


function setEndLocation(element, closingToken, treeAdapter) {
    const loc = element.__location;

    if (!loc)
        return;

    if (!loc.startTag) {
        loc.startTag = {
            line: loc.line,
            col: loc.col,
            startOffset: loc.startOffset,
            endOffset: loc.endOffset
        };
        if (loc.attrs)
            loc.startTag.attrs = loc.attrs;
    }

    if (closingToken.location) {
        const ctLocation = closingToken.location;
        const tn = treeAdapter.getTagName(element);

        const // NOTE: For cases like <p> <p> </p> - First 'p' closes without a closing tag and
        // for cases like <td> <p> </td> - 'p' closes without a closing tag
        isClosingEndTag = closingToken.type === Tokenizer.END_TAG_TOKEN &&
                          tn === closingToken.tagName;

        if (isClosingEndTag) {
            loc.endTag = {
                line: ctLocation.line,
                col: ctLocation.col,
                startOffset: ctLocation.startOffset,
                endOffset: ctLocation.endOffset
            };
        }

        if (isClosingEndTag)
            loc.endOffset = ctLocation.endOffset;
        else
            loc.endOffset = ctLocation.startOffset;
    }
}


export function assign(parser) {
    //NOTE: obtain Parser proto this way to avoid module circular references
    const parserProto = Object.getPrototypeOf(parser);

    const treeAdapter = parser.treeAdapter;
    let attachableElementLocation = null;
    let lastFosterParentingLocation = null;
    let currentToken = null;


    //NOTE: patch _bootstrap method
    parser._bootstrap = function (document, fragmentContext) {
        parserProto._bootstrap.call(this, document, fragmentContext);

        attachableElementLocation = null;
        lastFosterParentingLocation = null;
        currentToken = null;

        //OpenElementStack
        parser.openElements.pop = function () {
            setEndLocation(this.current, currentToken, treeAdapter);
            OpenElementStack.prototype.pop.call(this);
        };

        parser.openElements.popAllUpToHtmlElement = function () {
            for (let i = this.stackTop; i > 0; i--)
                setEndLocation(this.items[i], currentToken, treeAdapter);

            OpenElementStack.prototype.popAllUpToHtmlElement.call(this);
        };

        parser.openElements.remove = function (element) {
            setEndLocation(element, currentToken, treeAdapter);
            OpenElementStack.prototype.remove.call(this, element);
        };
    };


    //Token processing
    parser._processTokenInForeignContent = function (token) {
        currentToken = token;
        parserProto._processTokenInForeignContent.call(this, token);
    };

    parser._processToken = function (token) {
        currentToken = token;
        parserProto._processToken.call(this, token);

        //NOTE: <body> and <html> are never popped from the stack, so we need to updated
        //their end location explicitly.
        if (token.type === Tokenizer.END_TAG_TOKEN &&
            (token.tagName === $.HTML ||
             token.tagName === $.BODY && this.openElements.hasInScope($.BODY))) {
            for (let i = this.openElements.stackTop; i >= 0; i--) {
                const element = this.openElements.items[i];

                if (this.treeAdapter.getTagName(element) === token.tagName) {
                    setEndLocation(element, token, treeAdapter);
                    break;
                }
            }
        }
    };


    //Doctype
    parser._setDocumentType = function (token) {
        parserProto._setDocumentType.call(this, token);

        const documentChildren = this.treeAdapter.getChildNodes(this.document);
        const cnLength = documentChildren.length;

        for (let i = 0; i < cnLength; i++) {
            const node = documentChildren[i];

            if (this.treeAdapter.isDocumentTypeNode(node)) {
                node.__location = token.location;
                break;
            }
        }
    };


    //Elements
    parser._attachElementToTree = function (element) {
        //NOTE: _attachElementToTree is called from _appendElement, _insertElement and _insertTemplate methods.
        //So we will use token location stored in this methods for the element.
        element.__location = attachableElementLocation || null;
        attachableElementLocation = null;
        parserProto._attachElementToTree.call(this, element);
    };

    parser._appendElement = function (token, namespaceURI) {
        attachableElementLocation = token.location;
        parserProto._appendElement.call(this, token, namespaceURI);
    };

    parser._insertElement = function (token, namespaceURI) {
        attachableElementLocation = token.location;
        parserProto._insertElement.call(this, token, namespaceURI);
    };

    parser._insertTemplate = function (token) {
        attachableElementLocation = token.location;
        parserProto._insertTemplate.call(this, token);

        const tmplContent = this.treeAdapter.getTemplateContent(this.openElements.current);

        tmplContent.__location = null;
    };

    parser._insertFakeRootElement = function () {
        parserProto._insertFakeRootElement.call(this);
        this.openElements.current.__location = null;
    };


    //Comments
    parser._appendCommentNode = function (token, parent) {
        parserProto._appendCommentNode.call(this, token, parent);

        const children = this.treeAdapter.getChildNodes(parent);
        const commentNode = children[children.length - 1];

        commentNode.__location = token.location;
    };


    //Text
    parser._findFosterParentingLocation = function () {
        //NOTE: store last foster parenting location, so we will be able to find inserted text
        //in case of foster parenting
        lastFosterParentingLocation = parserProto._findFosterParentingLocation.call(this);
        return lastFosterParentingLocation;
    };

    parser._insertCharacters = function (token) {
        parserProto._insertCharacters.call(this, token);

        const hasFosterParent = this._shouldFosterParentOnInsertion();

        const parent = hasFosterParent && lastFosterParentingLocation.parent ||
                 this.openElements.currentTmplContent ||
                 this.openElements.current;

        const siblings = this.treeAdapter.getChildNodes(parent);

        const textNodeIdx = hasFosterParent && lastFosterParentingLocation.beforeElement ?
        siblings.indexOf(lastFosterParentingLocation.beforeElement) - 1 :
        siblings.length - 1;

        const textNode = siblings[textNodeIdx];

        //NOTE: if we have location assigned by another token, then just update end position
        if (textNode.__location)
            textNode.__location.endOffset = token.location.endOffset;

        else
            textNode.__location = token.location;
    };
}
