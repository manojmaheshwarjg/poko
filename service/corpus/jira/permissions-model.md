# Permissions model

## Schemes are shared between projects

A permission scheme is a named set of rules mapping each permission to the roles
that hold it. A scheme is not owned by one project. Several projects can point at
the same scheme, and the Permissions screen names how many ("shared by 4
projects").

This is the most common way to cause damage here. Editing a shared scheme changes
every project using it. If a change is meant for one project only, copy the scheme
first and associate the copy, rather than editing the shared one in place.

## Roles, not people

Permissions are granted to roles (Developers, Contractors), never to named
individuals. To change what one person can do, change which role they are in.
Changing the role's permissions affects everyone in that role, in every project
using the scheme.

## Permissions are independent

Each permission is granted separately. Removing Edit issues does not remove
Browse projects, add comments, or transition issues. Read-only access in the
usual sense means keeping Browse projects and dropping the permissions that
mutate an issue.

Granting Browse projects is a precondition for most other permissions being
meaningful: a role that cannot browse a project will not see its issues at all,
whatever else it holds.

## Access is not Permissions

Two different screens, routinely confused.

- **Access** controls who can reach the project at all, that is, membership.
- **Permissions** controls what someone can do once they are inside.

A question phrased as "can view but not edit" is a Permissions question, because
the person is already meant to reach the project. A question phrased as "should
not see this project at all" is an Access question.
